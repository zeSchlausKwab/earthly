//! User profiles, NIP-65 relay lists, relay health probes, key encoding,
//! LNURL zap invoices, and Community Shoutbox queries.

use std::collections::{BTreeMap, HashSet};
use std::time::Duration;

use nostr::nips::nip19::{FromBech32, Nip19, ToBech32};
use nostr::{Event, Filter, Kind, PublicKey};
use nostr_sdk::Client;

use super::entities::event_to_raw;
use super::{DEFAULT_EARTHLY_RELAY, EARTHLY_CITY_DEVELOPER_NPUB};

#[derive(Clone, Debug)]
pub struct ProfileMetadataDto {
    pub pubkey: String,
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub about: Option<String>,
    pub picture: Option<String>,
    pub nip05: Option<String>,
    pub website: Option<String>,
    pub banner: Option<String>,
    pub lud16: Option<String>,
}

/// Fetches Nostr `kind 0` author metadata profiles for the requested hex pubkeys.
pub async fn fetch_profiles(
    relay_urls: Vec<String>,
    pubkeys: Vec<String>,
) -> Result<Vec<ProfileMetadataDto>, String> {
    let mut authors = Vec::new();
    let mut seen = HashSet::new();
    for raw in pubkeys {
        if let Ok(pk) = PublicKey::parse(raw.trim()) {
            let hex = pk.to_hex();
            if seen.insert(hex) {
                authors.push(pk);
            }
        }
    }
    if authors.is_empty() {
        return Ok(Vec::new());
    }
    authors.truncate(60);

    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kind(Kind::Metadata)
        .authors(authors.clone())
        .limit(authors.len() * 2);

    let relay_res = client
        .fetch_events_from(&urls, filter.clone(), Duration::from_secs(6))
        .await;
    let mut events: Vec<Event> = match &relay_res {
        Ok(set) => set.iter().cloned().collect(),
        Err(_) => Vec::new(),
    };
    if relay_res.is_err() || events.len() < authors.len() {
        if let Ok(cached) = client.database().query(filter).await {
            events.extend(cached.into_iter());
        }
    }
    if events.is_empty() {
        if let Err(err) = relay_res {
            return Err(format!("failed to fetch author profiles: {err}"));
        }
    }

    let mut latest: BTreeMap<String, (u64, String)> = BTreeMap::new();
    for ev in events.into_iter() {
        let pk = ev.pubkey.to_hex();
        let ts = ev.created_at.as_secs();
        let replace = latest.get(&pk).map(|(cur, _)| ts >= *cur).unwrap_or(true);
        if replace {
            latest.insert(pk, (ts, ev.content));
        }
    }

    let mut out = Vec::with_capacity(latest.len());
    for (pubkey, (_, content)) in latest {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let pick_str = |key: &str| {
            json.get(key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        };
        out.push(ProfileMetadataDto {
            pubkey,
            name: pick_str("name"),
            display_name: pick_str("display_name").or_else(|| pick_str("displayName")),
            about: pick_str("about"),
            picture: pick_str("picture"),
            nip05: pick_str("nip05"),
            website: pick_str("website"),
            banner: pick_str("banner"),
            lud16: pick_str("lud16"),
        });
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub struct RelayListEntryDto {
    pub url: String,
    pub read: bool,
    pub write: bool,
}

#[derive(Clone, Debug)]
pub struct RelayHealthDto {
    pub url: String,
    pub reachable: bool,
    pub latency_ms: u32,
    pub error: Option<String>,
}

fn parse_nip65_tags(tags: &[Vec<String>]) -> Vec<RelayListEntryDto> {
    let mut seen: BTreeMap<String, (bool, bool)> = BTreeMap::new();
    for tag in tags {
        if tag.first().map(|s| s.as_str()) != Some("r") {
            continue;
        }
        let Some(raw_url) = tag.get(1).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        if !raw_url.starts_with("wss://") && !raw_url.starts_with("ws://") {
            continue;
        }
        let normalized = raw_url.trim_end_matches('/').to_owned();
        let marker = tag.get(2).map(|s| s.trim().to_ascii_lowercase());
        let (r, w) = match marker.as_deref() {
            Some("read") => (true, false),
            Some("write") => (false, true),
            _ => (true, true),
        };
        seen.entry(normalized)
            .and_modify(|e| {
                e.0 |= r;
                e.1 |= w;
            })
            .or_insert((r, w));
    }
    seen.into_iter()
        .map(|(url, (read, write))| RelayListEntryDto { url, read, write })
        .collect()
}

/// Fetches a user's NIP-65 (`kind 10002`) relay list metadata across configured
/// relays (falling back to `wss://purplepag.es` if needed).
pub async fn fetch_user_relay_list(
    relay_urls: Vec<String>,
    pubkey_or_npub: String,
) -> Result<Vec<RelayListEntryDto>, String> {
    let author = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|e| format!("invalid Nostr public key: {e}"))?;
    let mut urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };
    if !urls.iter().any(|u| u.contains("purplepag.es")) {
        urls.push("wss://purplepag.es".to_owned());
    }

    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kind(Kind::RelayList)
        .author(author)
        .limit(5);
    let events = client
        .fetch_events_from(&urls, filter, Duration::from_secs(6))
        .await
        .map_err(|e| format!("failed to fetch NIP-65 relay list: {e}"))?;

    let newest = events
        .into_iter()
        .max_by_key(|ev| (ev.created_at.as_secs(), ev.id));
    Ok(match newest {
        Some(ev) => {
            let raw = event_to_raw(&ev);
            parse_nip65_tags(&raw.tags)
        }
        None => Vec::new(),
    })
}

/// Probes WebSocket reachability and handshake latency (ms) for each relay URL.
pub async fn probe_relays_health(relay_urls: Vec<String>) -> Result<Vec<RelayHealthDto>, String> {
    let mut results = Vec::with_capacity(relay_urls.len());
    for raw in relay_urls {
        let url = raw.trim().to_owned();
        if !url.starts_with("wss://") && !url.starts_with("ws://") {
            results.push(RelayHealthDto {
                url,
                reachable: false,
                latency_ms: 0,
                error: Some("Unsupported URL scheme".to_owned()),
            });
            continue;
        }
        // Intentionally use an isolated temporary probe client (not the shared pool)
        // so fresh WebSocket/TLS connect latency is measured honestly.
        let client = Client::default();
        if let Err(err) = client.add_relay(&url).await {
            results.push(RelayHealthDto {
                url,
                reachable: false,
                latency_ms: 0,
                error: Some(err.to_string()),
            });
            continue;
        }
        let started = std::time::Instant::now();
        match client.try_connect_relay(&url, Duration::from_secs(4)).await {
            Ok(()) => {
                let elapsed = started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
                client.disconnect().await;
                results.push(RelayHealthDto {
                    url,
                    reachable: true,
                    latency_ms: elapsed,
                    error: None,
                });
            }
            Err(err) => {
                client.disconnect().await;
                results.push(RelayHealthDto {
                    url,
                    reachable: false,
                    latency_ms: 0,
                    error: Some(err.to_string()),
                });
            }
        }
    }
    Ok(results)
}

/// Encodes a 64-char hex pubkey (or normalizes an existing `npub1...`) to canonical `npub1...`.
pub fn pubkey_to_npub(pubkey_or_npub: String) -> Result<String, String> {
    let pk = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    pk.to_bech32()
        .map_err(|err| format!("failed to encode npub: {err}"))
}

/// Decodes a `nostr:npub1…`, `npub1…`, `nostr:nprofile1…`, `nprofile1…`, or 64-char hex
/// pubkey string into canonical lowercase 64-char hex.
pub fn decode_npub_to_hex(pubkey_or_npub: String) -> Option<String> {
    let trimmed = pubkey_or_npub
        .trim()
        .strip_prefix("nostr:")
        .or_else(|| pubkey_or_npub.trim().strip_prefix("NOSTR:"))
        .unwrap_or(pubkey_or_npub.trim());
    if let Ok(pk) = PublicKey::parse(trimmed) {
        return Some(pk.to_hex());
    }
    if let Ok(Nip19::Profile(profile)) = Nip19::from_bech32(trimmed) {
        return Some(profile.public_key.to_hex());
    }
    None
}

#[derive(Clone, Debug)]
pub struct ZapInvoiceDto {
    pub pr: String,
    pub verify_url: Option<String>,
    pub callback: String,
    pub min_sats: u64,
    pub max_sats: u64,
    pub allows_nostr: bool,
    pub amount_sats: u64,
}

#[derive(Clone, Debug)]
pub struct ShoutboxPostDto {
    pub event_id: String,
    pub pubkey: String,
    pub content: String,
    pub category: String,
    pub created_at: u64,
    pub hashtags: Vec<String>,
}

/// Encodes a 64-char hex pubkey (or `npub1...`) into canonical `npub1...`.
pub fn encode_hex_to_npub(pubkey_hex: String) -> Result<String, String> {
    let pk = PublicKey::parse(pubkey_hex.trim())
        .map_err(|err| format!("invalid public key: {err}"))?;
    pk.to_bech32()
        .map_err(|err| format!("failed to encode npub: {err}"))
}

fn resolve_lud16_to_lnurlp_url(lud16: &str) -> Result<String, String> {
    let trimmed = lud16.trim();
    let Some((user, domain)) = trimmed.split_once('@') else {
        return Err("Invalid Lightning Address (expected user@domain)".to_owned());
    };
    let user = user.trim();
    let domain = domain.trim();
    if user.is_empty()
        || domain.is_empty()
        || user.contains(['/', '?', '#', ' '])
        || domain.contains(['/', '?', '#', ' '])
    {
        return Err("Invalid Lightning Address format".to_owned());
    }
    let host_only = domain.split(':').next().unwrap_or(domain).to_ascii_lowercase();
    let scheme = if host_only == "localhost" || host_only == "127.0.0.1" {
        "http"
    } else {
        "https"
    };
    Ok(format!("{scheme}://{domain}/.well-known/lnurlp/{user}"))
}

/// Resolves a Lightning Address (`lud16`) via LNURL-pay and requests a BOLT-11
/// invoice (`pr`), attaching an optional signed NIP-57 `kind 9734` Zap Request.
pub async fn fetch_lnurl_zap_invoice(
    lud16: String,
    amount_sats: u64,
    signed_zap_request_json: Option<String>,
    comment: Option<String>,
) -> Result<ZapInvoiceDto, String> {
    if amount_sats == 0 {
        return Err("Zap amount must be at least 1 sat".to_owned());
    }
    let lnurl_url = resolve_lud16_to_lnurlp_url(&lud16)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let meta_resp = client
        .get(&lnurl_url)
        .send()
        .await
        .map_err(|e| format!("LNURL lookup failed for {lud16}: {e}"))?;
    if !meta_resp.status().is_success() {
        return Err(format!(
            "LNURL endpoint returned HTTP {} for {lud16}",
            meta_resp.status()
        ));
    }
    let meta: serde_json::Value = meta_resp
        .json()
        .await
        .map_err(|e| format!("invalid LNURL JSON metadata: {e}"))?;
    if meta.get("status").and_then(|v| v.as_str()) == Some("ERROR") {
        let reason = meta
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("LNURL error");
        return Err(reason.to_owned());
    }

    let callback = meta
        .get("callback")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "LNURL metadata missing callback URL".to_owned())?
        .to_owned();
    let min_sendable = meta
        .get("minSendable")
        .and_then(|v| v.as_u64())
        .unwrap_or(1_000);
    let max_sendable = meta
        .get("maxSendable")
        .and_then(|v| v.as_u64())
        .unwrap_or(100_000_000_000);
    let allows_nostr = meta
        .get("allowsNostr")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let comment_allowed = meta
        .get("commentAllowed")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let min_sats = min_sendable.div_ceil(1000).max(1);
    let max_sats = (max_sendable / 1000).max(min_sats);
    let amount_msats = amount_sats.saturating_mul(1000);
    if amount_msats < min_sendable || amount_msats > max_sendable {
        return Err(format!(
            "Recipient accepts between {min_sats} and {max_sats} sats"
        ));
    }

    let mut cb_url = reqwest::Url::parse(&callback)
        .map_err(|e| format!("invalid LNURL callback URL: {e}"))?;
    {
        let mut qp = cb_url.query_pairs_mut();
        qp.append_pair("amount", &amount_msats.to_string());
        if allows_nostr {
            if let Some(zap_json) = signed_zap_request_json
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                qp.append_pair("nostr", zap_json);
            }
        }
        if comment_allowed > 0 {
            if let Some(clean_comment) = comment
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                let truncated: String =
                    clean_comment.chars().take(comment_allowed as usize).collect();
                qp.append_pair("comment", &truncated);
            }
        }
    }

    let inv_resp = client
        .get(cb_url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch BOLT-11 invoice: {e}"))?;
    if !inv_resp.status().is_success() {
        return Err(format!(
            "LNURL callback returned HTTP {}",
            inv_resp.status()
        ));
    }
    let inv: serde_json::Value = inv_resp
        .json()
        .await
        .map_err(|e| format!("invalid LNURL invoice JSON: {e}"))?;
    if inv.get("status").and_then(|v| v.as_str()) == Some("ERROR") {
        let reason = inv
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("LNURL invoice error");
        return Err(reason.to_owned());
    }
    let pr = inv
        .get("pr")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "LNURL callback returned no BOLT-11 payment request".to_owned())?
        .to_owned();
    let verify_url = inv
        .get("verify")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    Ok(ZapInvoiceDto {
        pr,
        verify_url,
        callback,
        min_sats,
        max_sats,
        allows_nostr,
        amount_sats,
    })
}

fn shoutbox_filter_tag(category: &str) -> Result<(&'static str, &'static str), String> {
    match category.trim().to_ascii_lowercase().as_str() {
        "announcements" | "blog" => Ok(("announcements", "blog")),
        "features" | "feature" => Ok(("features", "feature")),
        "greetings" => Ok(("greetings", "greetings")),
        "bugs" | "bug" => Ok(("bugs", "bug")),
        other => Err(format!("Unsupported shoutbox category: {other}")),
    }
}

/// Fetches Community Shoutbox (`kind 1`, `#earthlycity`) notes for a specific
/// category (`announcements` | `features` | `greetings` | `bugs`).
pub async fn fetch_shoutbox_posts(
    relay_urls: Vec<String>,
    category: String,
    limit: u32,
) -> Result<Vec<ShoutboxPostDto>, String> {
    let (canonical_category, filter_tag) = shoutbox_filter_tag(&category)?;
    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kind(Kind::TextNote)
        .hashtag("earthlycity")
        .limit((limit as usize).clamp(1, 150));
    let events_res = client
        .fetch_events_from(&urls, filter, Duration::from_secs(8))
        .await;

    let events = events_res.map_err(|e| format!("failed to fetch shoutbox posts: {e}"))?;
    let dev_hex = PublicKey::parse(EARTHLY_CITY_DEVELOPER_NPUB)
        .map(|pk| pk.to_hex())
        .ok();

    let mut seen = HashSet::new();
    let mut posts = Vec::new();
    for ev in events {
        let raw = event_to_raw(&ev);
        if !seen.insert(raw.id.clone()) {
            continue;
        }
        let hashtags: Vec<String> = raw
            .tags
            .iter()
            .filter(|t| t.first().map(String::as_str) == Some("t"))
            .filter_map(|t| t.get(1).cloned())
            .collect();
        let has_category = hashtags
            .iter()
            .any(|t| t.eq_ignore_ascii_case(filter_tag));
        if !has_category {
            continue;
        }
        if canonical_category == "announcements" {
            if dev_hex.as_deref() != Some(raw.pubkey.as_str()) {
                continue;
            }
        }
        posts.push(ShoutboxPostDto {
            event_id: raw.id,
            pubkey: raw.pubkey,
            content: raw.content,
            category: canonical_category.to_owned(),
            created_at: raw.created_at,
            hashtags,
        });
    }

    posts.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.event_id.cmp(&b.event_id))
    });
    Ok(posts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[test]
    fn parses_nip65_relay_list_tags() {
        let tags = vec![
            vec!["r".to_owned(), "wss://relay.earthly.city/".to_owned()],
            vec![
                "r".to_owned(),
                "wss://nos.lol".to_owned(),
                "read".to_owned(),
            ],
            vec![
                "r".to_owned(),
                "wss://relay.damus.io".to_owned(),
                "write".to_owned(),
            ],
            vec!["r".to_owned(), "https://not-a-relay.invalid".to_owned()],
        ];
        let parsed = parse_nip65_tags(&tags);
        assert_eq!(parsed.len(), 3);
        let damus = parsed
            .iter()
            .find(|e| e.url == "wss://relay.damus.io")
            .unwrap();
        assert!(!damus.read && damus.write);
        let nos = parsed.iter().find(|e| e.url == "wss://nos.lol").unwrap();
        assert!(nos.read && !nos.write);
        let earthly = parsed
            .iter()
            .find(|e| e.url == "wss://relay.earthly.city")
            .unwrap();
        assert!(earthly.read && earthly.write);
    }

    #[test]
    fn resolves_lud16_lnurl_and_encodes_npub() {
        assert_eq!(
            resolve_lud16_to_lnurlp_url("satoshi@earthly.city").unwrap(),
            "https://earthly.city/.well-known/lnurlp/satoshi"
        );
        assert_eq!(
            resolve_lud16_to_lnurlp_url("dev@localhost:8080").unwrap(),
            "http://localhost:8080/.well-known/lnurlp/dev"
        );
        assert!(resolve_lud16_to_lnurlp_url("invalid-address").is_err());

        let keys = Keys::generate();
        let hex = keys.public_key().to_hex();
        let npub = encode_hex_to_npub(hex.clone()).unwrap();
        assert!(npub.starts_with("npub1"));
        assert_eq!(decode_npub_to_hex(npub).unwrap(), hex);

        let dev_hex = PublicKey::parse(EARTHLY_CITY_DEVELOPER_NPUB)
            .unwrap()
            .to_hex();
        assert_eq!(
            dev_hex,
            "3aa5817273c3b2f94f491840e0472f049d0f10009e23de63006166bca9b36ea3"
        );
    }
}
