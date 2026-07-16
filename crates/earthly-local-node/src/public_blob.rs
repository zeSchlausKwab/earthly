use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use reqwest::{Client, StatusCode};
use thiserror::Error;
use tokio::net::lookup_host;
use tokio_util::sync::CancellationToken;
use url::{Host, Url};

use crate::{BlobDescriptor, EmbeddedBlossom};

const MAX_MIRRORS: usize = 8;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicBlobDownload {
    pub descriptor: BlobDescriptor,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum PublicBlobDownloadError {
    #[error("invalid blob SHA-256")]
    InvalidHash,
    #[error("select between 1 and {MAX_MIRRORS} mirrors")]
    InvalidMirrors,
    #[error("unsafe map mirror URL: {0}")]
    UnsafeUrl(String),
    #[error("map mirror name resolution failed: {0}")]
    Resolution(String),
    #[error("map mirror requires authentication (HTTP {0})")]
    Authentication(u16),
    #[error("map mirror requires payment (HTTP 402)")]
    Payment,
    #[error("map download was cancelled")]
    Cancelled,
    #[error("all map mirrors failed: {0}")]
    AllMirrorsFailed(String),
}

pub(crate) async fn download_public_blob(
    blossom: &EmbeddedBlossom,
    hash: &str,
    mirror_urls: Vec<String>,
    cancellation: &CancellationToken,
    progress: Option<&(dyn Fn(u64) + Send + Sync)>,
) -> Result<PublicBlobDownload, PublicBlobDownloadError> {
    download_public_blob_with_policy(blossom, hash, mirror_urls, cancellation, progress, false)
        .await
}

async fn download_public_blob_with_policy(
    blossom: &EmbeddedBlossom,
    hash: &str,
    mirror_urls: Vec<String>,
    cancellation: &CancellationToken,
    progress: Option<&(dyn Fn(u64) + Send + Sync)>,
    allow_test_loopback: bool,
) -> Result<PublicBlobDownload, PublicBlobDownloadError> {
    if !is_sha256(hash) {
        return Err(PublicBlobDownloadError::InvalidHash);
    }
    if mirror_urls.is_empty() || mirror_urls.len() > MAX_MIRRORS {
        return Err(PublicBlobDownloadError::InvalidMirrors);
    }
    if let Some(descriptor) = blossom
        .local_blob_descriptor(hash)
        .await
        .map_err(|error| PublicBlobDownloadError::AllMirrorsFailed(error.to_string()))?
    {
        return Ok(PublicBlobDownload {
            descriptor,
            created: false,
        });
    }

    let mut failures = Vec::new();
    for value in mirror_urls {
        if cancellation.is_cancelled() {
            return Err(PublicBlobDownloadError::Cancelled);
        }
        let (url, host, addresses) =
            validate_and_resolve(&value, hash, allow_test_loopback).await?;
        let mut builder = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none());
        if !addresses.is_empty() {
            builder = builder.resolve_to_addrs(&host, &addresses);
        }
        let client = builder
            .build()
            .map_err(|error| PublicBlobDownloadError::AllMirrorsFailed(error.to_string()))?;
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Err(PublicBlobDownloadError::Cancelled),
            response = client.get(url.clone()).send() => response,
        };
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                failures.push(format!("{}: {error}", url.host_str().unwrap_or("mirror")));
                continue;
            }
        };
        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(PublicBlobDownloadError::Authentication(
                    response.status().as_u16(),
                ))
            }
            StatusCode::PAYMENT_REQUIRED => return Err(PublicBlobDownloadError::Payment),
            status if !status.is_success() => {
                failures.push(format!(
                    "{}: HTTP {}",
                    url.host_str().unwrap_or("mirror"),
                    status.as_u16()
                ));
                continue;
            }
            _ => {}
        }
        match blossom
            .adopt_remote_response_cancellable(hash, response, Some(cancellation), progress)
            .await
        {
            Ok((descriptor, created)) => {
                return Ok(PublicBlobDownload {
                    descriptor,
                    created,
                })
            }
            Err(_error) if cancellation.is_cancelled() => {
                return Err(PublicBlobDownloadError::Cancelled)
            }
            Err(error) => failures.push(format!("{}: {error}", url.host_str().unwrap_or("mirror"))),
        }
    }

    Err(PublicBlobDownloadError::AllMirrorsFailed(
        failures.join("; "),
    ))
}

async fn validate_and_resolve(
    value: &str,
    hash: &str,
    allow_test_loopback: bool,
) -> Result<(Url, String, Vec<SocketAddr>), PublicBlobDownloadError> {
    let url = Url::parse(value)
        .map_err(|_| PublicBlobDownloadError::UnsafeUrl("invalid URL".to_owned()))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(PublicBlobDownloadError::UnsafeUrl(
            "credentials, query strings, and fragments are not allowed".to_owned(),
        ));
    }
    let is_test_http = allow_test_loopback && url.scheme() == "http";
    if url.scheme() != "https" && !is_test_http {
        return Err(PublicBlobDownloadError::UnsafeUrl(
            "map mirrors must use HTTPS".to_owned(),
        ));
    }
    let filename = url
        .path_segments()
        .and_then(Iterator::last)
        .unwrap_or_default();
    if filename != hash && filename != format!("{hash}.pmtiles") {
        return Err(PublicBlobDownloadError::UnsafeUrl(
            "mirror path is not bound to the expected content hash".to_owned(),
        ));
    }
    let host = url
        .host()
        .ok_or_else(|| PublicBlobDownloadError::UnsafeUrl("mirror has no host".to_owned()))?;
    let host_name = url.host_str().unwrap_or_default().to_owned();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| PublicBlobDownloadError::UnsafeUrl("mirror has no port".to_owned()))?;
    let addresses = match host {
        Host::Ipv4(ip) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Host::Ipv6(ip) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        Host::Domain(domain) => lookup_host((domain, port))
            .await
            .map_err(|error| PublicBlobDownloadError::Resolution(error.to_string()))?
            .collect::<Vec<_>>(),
    };
    if addresses.is_empty() {
        return Err(PublicBlobDownloadError::Resolution(
            "mirror resolved to no addresses".to_owned(),
        ));
    }
    if !allow_test_loopback && addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(PublicBlobDownloadError::UnsafeUrl(
            "mirror resolves to a private, local, or reserved address".to_owned(),
        ));
    }
    Ok((url, host_name, addresses))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || octets[0] == 0
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || octets[0] >= 240)
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || octets[0] & 0xfe == 0xfc
        || (octets[0] == 0xfe && octets[1] & 0xc0 == 0x80)
        || (octets[0] == 0x20 && octets[1] == 0x01 && octets[2] == 0x0d && octets[3] == 0xb8))
}

#[cfg(test)]
mod tests {
    use axum::routing::get;
    use axum::Router;
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::{NodeAvailability, NodeConfig, PairingManager, PeerPolicy};

    #[test]
    fn public_address_policy_rejects_local_and_reserved_ranges() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.1.1",
            "192.0.2.1",
            "::1",
            "fd00::1",
        ] {
            assert!(!is_public_ip(value.parse().unwrap()));
        }
        assert!(is_public_ip("1.1.1.1".parse().unwrap()));
        assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[tokio::test]
    async fn corrupt_first_mirror_fails_over_before_adoption() {
        let directory = tempfile::tempdir().unwrap();
        let config = NodeConfig::loopback(directory.path(), NodeAvailability::Process)
            .with_ephemeral_ports();
        let peers = PeerPolicy::load(directory.path().join("test-policy"))
            .await
            .unwrap();
        let pairing = PairingManager::open(directory.path().join("test-pairing"))
            .await
            .unwrap();
        let blossom = EmbeddedBlossom::start(
            &config,
            peers,
            pairing,
            nostr::Keys::generate().public_key(),
        )
        .await
        .unwrap();

        let expected = b"verified map archive";
        let hash = format!("{:x}", Sha256::digest(expected));
        let corrupt = start_server(b"corrupt".to_vec()).await;
        let valid = start_server(expected.to_vec()).await;
        let cancellation = CancellationToken::new();
        let descriptor = download_public_blob_with_policy(
            &blossom,
            &hash,
            vec![
                format!("http://{corrupt}/{hash}.pmtiles"),
                format!("http://{valid}/{hash}.pmtiles"),
            ],
            &cancellation,
            None,
            true,
        )
        .await
        .unwrap();

        assert_eq!(descriptor.descriptor.sha256, hash);
        assert_eq!(descriptor.descriptor.size, expected.len() as u64);
        assert!(descriptor.created);
        assert!(blossom
            .has_blob(&descriptor.descriptor.sha256)
            .await
            .unwrap());
    }

    async fn start_server(body: Vec<u8>) -> SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/{*path}",
                    get(move || {
                        let body = body.clone();
                        async move { body }
                    }),
                ),
            )
            .await
            .unwrap();
        });
        address
    }
}
