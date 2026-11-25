//! NIP-47 Nostr Wallet Connect (`nostr+walletconnect://`) client in Rust:
//! URI validation, wallet info/balance inspection, and 1-tap BOLT-11 payment.

use std::time::Duration;

use nostr::nips::nip47::{
    Method, NostrWalletConnectURI, PayInvoiceRequest, Request, Response, ResponseResult,
};
use nostr::{Filter, Kind};
use nostr_sdk::{Client, RelayPoolNotification};

#[derive(Clone, Debug)]
pub struct NwcConnectionInfoDto {
    pub service_pubkey: String,
    pub relays: Vec<String>,
    pub lud16: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NwcWalletStatusDto {
    pub service_pubkey: String,
    pub relays: Vec<String>,
    pub lud16: Option<String>,
    pub methods: Vec<String>,
    pub balance_sats: Option<u64>,
    pub can_pay: bool,
}

#[derive(Clone, Debug)]
pub struct NwcPaymentResultDto {
    pub preimage: String,
    pub fees_paid_msats: Option<u64>,
}

/// Validates and parses a `nostr+walletconnect://` URI offline.
pub fn parse_nwc_uri(uri: String) -> Result<NwcConnectionInfoDto, String> {
    let parsed = NostrWalletConnectURI::parse(uri.trim())
        .map_err(|err| format!("Invalid NIP-47 Wallet Connect URI: {err}"))?;
    if parsed.relays.is_empty() {
        return Err("NWC URI must specify at least one relay URL".to_owned());
    }
    Ok(NwcConnectionInfoDto {
        service_pubkey: parsed.public_key.to_hex(),
        relays: parsed.relays.iter().map(|r| r.to_string()).collect(),
        lud16: parsed.lud16,
    })
}

fn method_label(m: Method) -> &'static str {
    match m {
        Method::PayInvoice => "pay_invoice",
        Method::MultiPayInvoice => "multi_pay_invoice",
        Method::PayKeysend => "pay_keysend",
        Method::MultiPayKeysend => "multi_pay_keysend",
        Method::MakeInvoice => "make_invoice",
        Method::LookupInvoice => "lookup_invoice",
        Method::ListTransactions => "list_transactions",
        Method::GetBalance => "get_balance",
        Method::GetInfo => "get_info",
        Method::MakeHoldInvoice => "make_hold_invoice",
        Method::CancelHoldInvoice => "cancel_hold_invoice",
        Method::SettleHoldInvoice => "settle_hold_invoice",
    }
}

async fn send_nwc_request(
    uri: &NostrWalletConnectURI,
    request: Request,
    timeout_secs: u64,
) -> Result<Response, String> {
    let req_event = request
        .to_event(uri)
        .map_err(|err| format!("Failed to encrypt NIP-47 request: {err}"))?;

    let client = Client::default();
    for relay in &uri.relays {
        client
            .add_relay(relay.as_str())
            .await
            .map_err(|err| format!("Invalid NWC relay {relay}: {err}"))?;
    }
    client.connect().await;

    let filter = Filter::new()
        .kind(Kind::WalletConnectResponse)
        .author(uri.public_key)
        .event(req_event.id);
    if let Err(err) = client.subscribe(filter, None).await {
        client.disconnect().await;
        return Err(format!("Failed to subscribe to NWC response: {err}"));
    }
    if let Err(err) = client.send_event(&req_event).await {
        client.disconnect().await;
        return Err(format!("Failed to publish NWC request: {err}"));
    }

    let mut notifications = client.notifications();
    let res = tokio::time::timeout(Duration::from_secs(timeout_secs), async {
        while let Ok(note) = notifications.recv().await {
            if let RelayPoolNotification::Event { event, .. } = note {
                if event.kind == Kind::WalletConnectResponse {
                    if let Ok(parsed) = Response::from_event(uri, &event) {
                        return Ok(parsed);
                    }
                }
            }
        }
        Err("NWC notification stream closed before wallet replied".to_owned())
    })
    .await;

    client.disconnect().await;

    let resp = match res {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Timed out waiting for NWC wallet response".to_owned()),
    };

    if let Some(err) = resp.error {
        return Err(format!("NWC wallet error ({:?}): {}", err.code, err.message));
    }
    Ok(resp)
}

/// Connects to an NWC wallet service relay and queries `get_info` / `get_balance`.
pub async fn fetch_nwc_wallet_status(nwc_uri: String) -> Result<NwcWalletStatusDto, String> {
    let uri = NostrWalletConnectURI::parse(nwc_uri.trim())
        .map_err(|err| format!("Invalid NWC URI: {err}"))?;
    if uri.relays.is_empty() {
        return Err("NWC URI missing relays".to_owned());
    }

    let mut methods = Vec::new();
    let mut can_pay = true;
    if let Ok(info_resp) = send_nwc_request(&uri, Request::get_info(), 10).await {
        if let Some(ResponseResult::GetInfo(info)) = info_resp.result {
            methods = info
                .methods
                .into_iter()
                .map(|m| method_label(m).to_owned())
                .collect();
            if !methods.is_empty() {
                can_pay = methods.iter().any(|m| m == "pay_invoice");
            }
        }
    }

    let should_query_balance =
        methods.is_empty() || methods.iter().any(|m| m == "get_balance");
    let mut balance_sats = None;
    if should_query_balance {
        if let Ok(bal_resp) = send_nwc_request(&uri, Request::get_balance(), 10).await {
            if let Some(ResponseResult::GetBalance(bal)) = bal_resp.result {
                balance_sats = Some(bal.balance / 1000);
            }
        }
    }

    Ok(NwcWalletStatusDto {
        service_pubkey: uri.public_key.to_hex(),
        relays: uri.relays.iter().map(|r| r.to_string()).collect(),
        lud16: uri.lud16,
        methods,
        balance_sats,
        can_pay,
    })
}

/// Pays a BOLT-11 Lightning invoice via NIP-47 `pay_invoice`.
pub async fn pay_invoice_via_nwc(
    nwc_uri: String,
    bolt11: String,
) -> Result<NwcPaymentResultDto, String> {
    let invoice = bolt11.trim();
    if invoice.is_empty() {
        return Err("BOLT-11 invoice cannot be empty".to_owned());
    }
    let uri = NostrWalletConnectURI::parse(nwc_uri.trim())
        .map_err(|err| format!("Invalid NWC URI: {err}"))?;
    if uri.relays.is_empty() {
        return Err("NWC URI missing relays".to_owned());
    }

    let resp = send_nwc_request(
        &uri,
        Request::pay_invoice(PayInvoiceRequest::new(invoice)),
        25,
    )
    .await?;

    match resp.result {
        Some(ResponseResult::PayInvoice(paid)) => Ok(NwcPaymentResultDto {
            preimage: paid.preimage,
            fees_paid_msats: paid.fees_paid,
        }),
        _ => Err("Unexpected NWC response payload for pay_invoice".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{Keys, RelayUrl};

    #[test]
    fn parses_valid_and_rejects_invalid_nwc_uri() {
        let service = Keys::generate();
        let secret = Keys::generate();
        let uri = NostrWalletConnectURI::new(
            service.public_key(),
            vec![RelayUrl::parse("wss://relay.earthly.city").unwrap()],
            secret.secret_key().clone(),
            Some("zap@earthly.city".to_owned()),
        );
        let parsed = parse_nwc_uri(uri.to_string()).unwrap();
        assert_eq!(parsed.service_pubkey, service.public_key().to_hex());
        assert_eq!(parsed.relays, vec!["wss://relay.earthly.city"]);
        assert_eq!(parsed.lud16.as_deref(), Some("zap@earthly.city"));

        assert!(parse_nwc_uri("https://earthly.city".to_owned()).is_err());
        assert!(parse_nwc_uri(format!("nostr+walletconnect://{}", service.public_key().to_hex())).is_err());
    }

    #[test]
    fn builds_signed_nip47_pay_invoice_request_event() {
        let service = Keys::generate();
        let secret = Keys::generate();
        let uri = NostrWalletConnectURI::new(
            service.public_key(),
            vec![RelayUrl::parse("wss://relay.earthly.city").unwrap()],
            secret.secret_key().clone(),
            None,
        );
        let req = Request::pay_invoice(PayInvoiceRequest::new("lnbc10u1ptestinvoice"));
        let ev = req.to_event(&uri).unwrap();
        assert_eq!(ev.kind, Kind::WalletConnectRequest);
        assert!(ev.verify().is_ok());
        assert!(ev.tags.iter().any(|t| {
            t.as_slice().first().map(String::as_str) == Some("p")
                && t.as_slice().get(1).map(String::as_str) == Some(&service.public_key().to_hex())
        }));
    }
}
