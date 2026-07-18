use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use reqwest::{Client, StatusCode};
use thiserror::Error;
use tokio::net::lookup_host;
use tokio_util::sync::CancellationToken;
use url::{Host, Url};

use crate::{BlobDescriptor, EmbeddedBlossom, LocalBlobIntegrity, NodeError};

const MAX_MIRRORS: usize = 8;
const MAX_CONTENT_BLOB_BYTES: u64 = 50 * 1024 * 1024;
const DNS_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MirrorPathPolicy {
    HashBound,
    SignedContentUrl,
}

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
    #[error("content blob is {size} bytes; the offline limit is {limit} bytes")]
    ContentTooLarge { size: u64, limit: u64 },
    #[error("local map storage failed: {0}")]
    Storage(String),
    #[error("all map mirrors failed: {0}")]
    AllMirrorsFailed(String),
}

fn local_blob_error(error: NodeError) -> PublicBlobDownloadError {
    match error {
        NodeError::Io(error) => PublicBlobDownloadError::Storage(error.to_string()),
        error => PublicBlobDownloadError::AllMirrorsFailed(error.to_string()),
    }
}

pub(crate) async fn download_public_blob(
    blossom: &EmbeddedBlossom,
    hash: &str,
    mirror_urls: Vec<String>,
    expected_size: Option<u64>,
    cancellation: &CancellationToken,
    progress: Option<&(dyn Fn(u64) + Send + Sync)>,
) -> Result<PublicBlobDownload, PublicBlobDownloadError> {
    download_public_blob_with_policy(
        blossom,
        hash,
        mirror_urls,
        cancellation,
        progress,
        false,
        MirrorPathPolicy::HashBound,
        expected_size,
    )
    .await
}

pub(crate) async fn download_public_content_blob(
    blossom: &EmbeddedBlossom,
    hash: &str,
    source_urls: Vec<String>,
    expected_size: Option<u64>,
    cancellation: &CancellationToken,
    progress: Option<&(dyn Fn(u64) + Send + Sync)>,
) -> Result<PublicBlobDownload, PublicBlobDownloadError> {
    download_public_blob_with_policy(
        blossom,
        hash,
        source_urls,
        cancellation,
        progress,
        false,
        MirrorPathPolicy::SignedContentUrl,
        Some(
            expected_size
                .unwrap_or(MAX_CONTENT_BLOB_BYTES)
                .min(MAX_CONTENT_BLOB_BYTES),
        ),
    )
    .await
}

async fn download_public_blob_with_policy(
    blossom: &EmbeddedBlossom,
    hash: &str,
    mirror_urls: Vec<String>,
    cancellation: &CancellationToken,
    progress: Option<&(dyn Fn(u64) + Send + Sync)>,
    allow_test_loopback: bool,
    path_policy: MirrorPathPolicy,
    max_bytes: Option<u64>,
) -> Result<PublicBlobDownload, PublicBlobDownloadError> {
    if !is_sha256(hash) {
        return Err(PublicBlobDownloadError::InvalidHash);
    }
    if mirror_urls.is_empty() || mirror_urls.len() > MAX_MIRRORS {
        return Err(PublicBlobDownloadError::InvalidMirrors);
    }
    match blossom
        .verify_local_blob(hash)
        .await
        .map_err(local_blob_error)?
    {
        LocalBlobIntegrity::Verified(descriptor) => {
            ensure_descriptor_within_policy(&descriptor, path_policy, max_bytes)?;
            return Ok(PublicBlobDownload {
                descriptor,
                created: false,
            });
        }
        LocalBlobIntegrity::Missing => {}
        LocalBlobIntegrity::Corrupt { .. } => {
            blossom
                .remove_local_blob(hash)
                .await
                .map_err(local_blob_error)?;
        }
    }

    let mut failures = Vec::new();
    for value in mirror_urls {
        if cancellation.is_cancelled() {
            return Err(PublicBlobDownloadError::Cancelled);
        }
        let (url, host, addresses) = match validate_and_resolve(
            &value,
            hash,
            allow_test_loopback,
            path_policy,
            cancellation,
        )
        .await
        {
            Ok(resolved) => resolved,
            Err(PublicBlobDownloadError::Resolution(message)) => {
                failures.push(format!("{value}: {message}"));
                continue;
            }
            Err(error) => return Err(error),
        };
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
            .adopt_remote_response_cancellable(
                hash,
                response,
                Some(cancellation),
                progress,
                max_bytes,
            )
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
            Err(NodeError::Io(error)) => {
                return Err(PublicBlobDownloadError::Storage(error.to_string()))
            }
            Err(error) => failures.push(format!("{}: {error}", url.host_str().unwrap_or("mirror"))),
        }
    }

    Err(PublicBlobDownloadError::AllMirrorsFailed(
        failures.join("; "),
    ))
}

fn ensure_descriptor_within_policy(
    descriptor: &BlobDescriptor,
    path_policy: MirrorPathPolicy,
    max_bytes: Option<u64>,
) -> Result<(), PublicBlobDownloadError> {
    let limit = max_bytes.unwrap_or(MAX_CONTENT_BLOB_BYTES);
    if path_policy == MirrorPathPolicy::SignedContentUrl && descriptor.size > limit {
        return Err(PublicBlobDownloadError::ContentTooLarge {
            size: descriptor.size,
            limit,
        });
    }
    Ok(())
}

async fn validate_and_resolve(
    value: &str,
    hash: &str,
    allow_test_loopback: bool,
    path_policy: MirrorPathPolicy,
    cancellation: &CancellationToken,
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
    if path_policy == MirrorPathPolicy::HashBound {
        let filename = url
            .path_segments()
            .and_then(Iterator::last)
            .unwrap_or_default();
        if filename != hash && filename != format!("{hash}.pmtiles") {
            return Err(PublicBlobDownloadError::UnsafeUrl(
                "mirror path is not bound to the expected content hash".to_owned(),
            ));
        }
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
        Host::Domain(domain) => {
            let lookup = tokio::time::timeout(
                DNS_RESOLUTION_TIMEOUT,
                lookup_host((domain.to_owned(), port)),
            );
            let resolved = tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Err(PublicBlobDownloadError::Cancelled),
                resolved = lookup => resolved,
            }
            .map_err(|_| PublicBlobDownloadError::Resolution("DNS lookup timed out".to_owned()))?
            .map_err(|error| PublicBlobDownloadError::Resolution(error.to_string()))?;
            resolved.collect::<Vec<_>>()
        }
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
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
        || (octets[0] == 198 && (18..=19).contains(&octets[1]))
        || octets[0] >= 240)
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    let octets = ip.octets();
    // Only globally assigned unicast space is eligible. This rejects IPv4-compatible,
    // NAT64/local translation, site/link-local, discard-only, multicast, and ULA ranges
    // without trying to enumerate every non-routable prefix inside ::/0.
    if !(0x20..=0x3f).contains(&octets[0]) {
        return false;
    }
    // Special-use prefixes that sit inside 2000::/3 but are not globally reachable.
    !(segments_start_with(&octets, &[0x20, 0x01, 0x00, 0x00]) // Teredo 2001::/32
        || segments_start_with(&octets, &[0x20, 0x01, 0x00, 0x02, 0x00, 0x00]) // benchmark /48
        || (segments_start_with(&octets, &[0x20, 0x01, 0x00])
            && matches!(octets[3] & 0xf0, 0x10 | 0x20)) // ORCHID /28
        || segments_start_with(&octets, &[0x20, 0x01, 0x0d, 0xb8]) // documentation /32
        || segments_start_with(&octets, &[0x20, 0x02]) // 6to4 /16
        || (octets[0] == 0x3f && octets[1] & 0xf0 == 0xf0)) // documentation 3fff::/20
}

fn segments_start_with(address: &[u8; 16], prefix: &[u8]) -> bool {
    address.get(..prefix.len()) == Some(prefix)
}

#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use axum::body::{Body, Bytes};
    use axum::routing::get;
    use axum::Router;
    use futures_util::stream;
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
            "192.0.0.1",
            "198.18.0.1",
            "::1",
            "::127.0.0.1",
            "fd00::1",
            "fec0::1",
            "64:ff9b:1::7f00:1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
        ] {
            assert!(!is_public_ip(value.parse().unwrap()));
        }
        assert!(is_public_ip("1.1.1.1".parse().unwrap()));
        assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[tokio::test]
    async fn mirror_dns_resolution_honors_cancellation() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let hash = "a".repeat(64);

        assert!(matches!(
            validate_and_resolve(
                &format!("https://example.com/{hash}.pmtiles"),
                &hash,
                false,
                MirrorPathPolicy::HashBound,
                &cancellation,
            )
            .await,
            Err(PublicBlobDownloadError::Cancelled)
        ));
    }

    #[test]
    fn preexisting_oversized_content_is_not_accepted_from_local_storage() {
        let descriptor = BlobDescriptor {
            url: "http://127.0.0.1/blob".parse().unwrap(),
            sha256: "a".repeat(64),
            size: MAX_CONTENT_BLOB_BYTES + 1,
            media_type: "application/geo+json".to_owned(),
            uploaded: 0,
        };

        assert!(matches!(
            ensure_descriptor_within_policy(
                &descriptor,
                MirrorPathPolicy::SignedContentUrl,
                Some(MAX_CONTENT_BLOB_BYTES),
            ),
            Err(PublicBlobDownloadError::ContentTooLarge { .. })
        ));
        assert!(
            ensure_descriptor_within_policy(&descriptor, MirrorPathPolicy::HashBound, None).is_ok()
        );
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
            MirrorPathPolicy::HashBound,
            None,
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

    #[tokio::test]
    async fn unresolvable_first_mirror_does_not_block_a_later_valid_mirror() {
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
        let expected = b"verified map bytes";
        let hash = format!("{:x}", Sha256::digest(expected));
        let valid = start_server(expected.to_vec()).await;
        let downloaded = download_public_blob_with_policy(
            &blossom,
            &hash,
            vec![
                format!("http://unresolvable.invalid/{hash}.pmtiles"),
                format!("http://{valid}/{hash}.pmtiles"),
            ],
            &CancellationToken::new(),
            None,
            true,
            MirrorPathPolicy::HashBound,
            None,
        )
        .await
        .unwrap();

        assert_eq!(downloaded.descriptor.sha256, hash);
    }

    #[tokio::test]
    async fn signed_content_urls_may_use_non_hash_paths_but_bytes_still_match_the_hash() {
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
        let expected = br#"{"type":"FeatureCollection","features":[]}"#;
        let hash = format!("{:x}", Sha256::digest(expected));
        let server = start_server(expected.to_vec()).await;
        let downloaded = download_public_blob_with_policy(
            &blossom,
            &hash,
            vec![format!("http://{server}/signed/dataset.geojson")],
            &CancellationToken::new(),
            None,
            true,
            MirrorPathPolicy::SignedContentUrl,
            Some(MAX_CONTENT_BLOB_BYTES),
        )
        .await
        .unwrap();

        assert_eq!(downloaded.descriptor.sha256, hash);
        assert!(downloaded.created);
    }

    #[tokio::test]
    async fn bounded_adoption_stops_a_chunked_response_that_crosses_its_limit() {
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
        let bytes = b"0123456789";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let server = start_chunked_server().await;
        let response = reqwest::Client::new()
            .get(format!("http://{server}/chunked"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.content_length(), None);

        let error = blossom
            .adopt_remote_response_cancellable(&hash, response, None, None, Some(8))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("size limit"));
        assert!(blossom
            .local_blob_descriptor(&hash)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn signed_basemap_size_rejects_an_oversized_content_length_before_adoption() {
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
        let bytes = b"0123456789";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let server = start_server(bytes.to_vec()).await;

        let error = download_public_blob_with_policy(
            &blossom,
            &hash,
            vec![format!("http://{server}/{hash}.pmtiles")],
            &CancellationToken::new(),
            None,
            true,
            MirrorPathPolicy::HashBound,
            Some(8),
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("size limit"));
        assert!(blossom
            .local_blob_descriptor(&hash)
            .await
            .unwrap()
            .is_none());
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

    async fn start_chunked_server() -> SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/{*path}",
                    get(|| async {
                        Body::from_stream(stream::iter([
                            Ok::<_, Infallible>(Bytes::from_static(b"01234")),
                            Ok::<_, Infallible>(Bytes::from_static(b"56789")),
                        ]))
                    }),
                ),
            )
            .await
            .unwrap();
        });
        address
    }
}
