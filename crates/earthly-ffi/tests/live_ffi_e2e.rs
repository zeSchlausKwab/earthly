//! End-to-end integration tests exercising real `earthly-ffi` flows against
//! temporary directories, SQLite SecretBox stores, an ephemeral in-process
//! `LocalNode` relay + `NostrLMDB`, a live `McpBridgeServer` HTTP endpoint,
//! and Geo multipart / shapefile / CSV round-trips.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use earthly_ffi::api::geo::{
    geo_explode_multipart, geo_export_gpx, geo_export_kml, geo_export_shapefile_zip,
    geo_import_shapefile_bytes, geo_import_spatial_file, geo_merge_to_multipart,
    geo_validate_draft_geojson,
};
use earthly_ffi::api::mcp_bridge::{
    McpWorkspaceDto, drain_mcp_mutations, get_mcp_bridge_status, start_mcp_bridge,
    stop_mcp_bridge, sync_mcp_workspace,
};
use earthly_ffi::api::nostr_client::{
    decode_naddr_coordinate, encode_naddr_coordinate, fetch_earthly_catalog,
    fetch_local_node_catalog,
};
use earthly_ffi::api::publish::{
    delete_local_draft, generate_local_nostr_keypair, list_local_drafts, list_outbox_items,
    load_local_draft, prepare_unsigned_map_event, publish_nearby_event_via_outbox,
    publish_signed_event_via_outbox, save_local_draft, sign_event_with_nsec,
};
use earthly_ffi::api::relay_pool::init_relay_pool;
use earthly_ffi::api::settings::{
    SavedAccountSessionDto, load_app_settings, save_app_settings, set_settings_master_key,
};
use earthly_ffi::api::spike::{shutdown_local_node, start_local_node};
use earthly_ffi::api::wallet::{add_cashu_mint, init_cashu_wallet, load_cashu_wallet_state};
use earthly_local_node::{LocalNode, NodeAvailability, NodeConfig};
use reqwest::StatusCode;
use serde_json::{Value, json};
use tempfile::tempdir;

#[test]
fn secretbox_settings_cashu_wallet_and_draft_cold_restart_round_trip() {
    let dir = tempdir().expect("tempdir");
    let settings_db = dir.path().join("settings.sqlite3");
    let wallet_db = dir.path().join("wallet.sqlite3");
    let drafts_db = dir.path().join("drafts.sqlite3");

    let master_key = STANDARD.encode([0x5au8; 32]);
    let wrong_key = STANDARD.encode([0x99u8; 32]);
    set_settings_master_key(master_key.clone()).expect("set master key");

    let kp = generate_local_nostr_keypair().expect("generate keypair");
    let mut settings = load_app_settings(settings_db.display().to_string()).expect("load defaults");
    settings.local_pubkey_hex = Some(kp.pubkey_hex.clone());
    settings.local_nsec = Some(kp.nsec.clone());
    settings.nwc_uri = Some("nostr+walletconnect://e2e?secret=topsecret".to_owned());
    settings.agent_api_key = "sk-e2e-secret-api-key".to_owned();
    settings.saved_accounts = vec![SavedAccountSessionDto {
        id: format!("local:{}", kp.pubkey_hex),
        kind: "local".to_owned(),
        pubkey_hex: kp.pubkey_hex.clone(),
        local_nsec: Some(kp.nsec.clone()),
        bunker_uri: None,
        bunker_client_nsec: None,
        signer_package: None,
        label: Some("Field E2E".to_owned()),
    }];
    settings.active_account_id = Some(format!("local:{}", kp.pubkey_hex));

    save_app_settings(settings_db.display().to_string(), settings)
        .expect("save encrypted settings");

    // Verify no plaintext secrets hit SQLite files on disk.
    for candidate in [&settings_db, &dir.path().join("settings.sqlite3-wal")] {
        if candidate.exists() {
            let bytes = std::fs::read(candidate).expect("read sqlite");
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains(&kp.nsec));
            assert!(!text.contains("sk-e2e-secret-api-key"));
            assert!(!text.contains("nostr+walletconnect://e2e"));
        }
    }

    // Wrong master key must fail closed on cold restart.
    set_settings_master_key(wrong_key.clone()).expect("switch to wrong key");
    assert!(load_app_settings(settings_db.display().to_string()).is_err());

    // Correct master key restores full encrypted settings.
    set_settings_master_key(master_key.clone()).expect("restore master key");
    let reloaded_settings =
        load_app_settings(settings_db.display().to_string()).expect("reload settings");
    assert_eq!(reloaded_settings.local_nsec.as_deref(), Some(kp.nsec.as_str()));
    assert_eq!(reloaded_settings.agent_api_key, "sk-e2e-secret-api-key");
    assert_eq!(reloaded_settings.saved_accounts.len(), 1);
    assert_eq!(
        reloaded_settings.saved_accounts[0].local_nsec.as_deref(),
        Some(kp.nsec.as_str())
    );

    // Cashu WalletStore cold-restart persistence with SecretBox encryption.
    let initialized_wallet = init_cashu_wallet(
        wallet_db.display().to_string(),
        kp.pubkey_hex.clone(),
        vec!["https://mint.earthly.city".to_owned()],
        vec!["wss://relay.earthly.city".to_owned()],
        Some(master_key.clone()),
    )
    .expect("init wallet");
    assert!(!initialized_wallet.p2pk_pubkey_hex.is_empty());
    assert_eq!(
        initialized_wallet.default_mint.as_deref(),
        Some("https://mint.earthly.city")
    );

    let with_second_mint = add_cashu_mint(
        wallet_db.display().to_string(),
        kp.pubkey_hex.clone(),
        "https://8333.space:3338".to_owned(),
        Some(master_key.clone()),
    )
    .expect("add mint");
    assert_eq!(with_second_mint.mints.len(), 2);

    // Wrong key fails closed for WalletStore too.
    assert!(
        load_cashu_wallet_state(
            wallet_db.display().to_string(),
            kp.pubkey_hex.clone(),
            Some(wrong_key),
        )
        .is_err()
    );

    // Reopening from disk with the right master key preserves mints & P2PK key.
    let reloaded_wallet = load_cashu_wallet_state(
        wallet_db.display().to_string(),
        kp.pubkey_hex.clone(),
        Some(master_key),
    )
    .expect("reload wallet");
    assert_eq!(reloaded_wallet.mints, with_second_mint.mints);
    assert_eq!(
        reloaded_wallet.p2pk_pubkey_hex,
        initialized_wallet.p2pk_pubkey_hex
    );

    // LocalDraft cold-restart round-trip in SQLite.
    let sample_fc = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Stephansplatz"}}]}"#;
    let saved_draft = save_local_draft(
        drafts_db.display().to_string(),
        "draft-e2e-1".to_owned(),
        "vienna-e2e".to_owned(),
        "Vienna E2E".to_owned(),
        Some("Cold restart draft".to_owned()),
        "public".to_owned(),
        None,
        sample_fc.to_owned(),
    )
    .expect("save draft");
    assert_eq!(saved_draft.title, "Vienna E2E");
    let loaded_draft = load_local_draft(drafts_db.display().to_string(), "draft-e2e-1".to_owned())
        .expect("load draft")
        .expect("draft present");
    assert_eq!(loaded_draft.d_tag, "vienna-e2e");
    assert_eq!(
        list_local_drafts(drafts_db.display().to_string())
            .expect("list drafts")
            .len(),
        1
    );
    assert!(
        delete_local_draft(drafts_db.display().to_string(), "draft-e2e-1".to_owned())
            .expect("delete draft")
    );
}

#[tokio::test]
async fn ephemeral_local_node_relay_and_nostr_lmdb_offline_fallback_e2e() {
    let dir = tempdir().expect("tempdir");
    let open_node_dir = dir.path().join("open-local-node");
    let pool_dir = dir.path().join("relay-pool");
    let outbox_db = dir.path().join("outbox.sqlite3");
    let nearby_node_dir = dir.path().join("nearby-local-node");
    let nearby_outbox_db = dir.path().join("nearby-outbox.sqlite3");

    // 1. Start an ephemeral in-process LocalNode relay with open loopback access
    //    (relay_nip42 = false) so standard WebSocket publish/fetch works end-to-end.
    let mut cfg = NodeConfig::loopback(&open_node_dir, NodeAvailability::Process).with_ephemeral_ports();
    cfg.relay_nip42 = false;
    let node = LocalNode::start(cfg).await.expect("start ephemeral LocalNode");
    let relay_url = node.descriptor().relay_url.to_string();

    // Initialize persistent NostrLMDB pool pointing at the ephemeral relay.
    init_relay_pool(pool_dir.display().to_string(), vec![relay_url.clone()])
        .await
        .expect("init NostrLMDB relay pool");

    let kp = generate_local_nostr_keypair().expect("generate keypair");
    let geojson = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"pt-live","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Danube Canal"}}]}"#;
    let unsigned = prepare_unsigned_map_event(
        kp.pubkey_hex.clone(),
        "live-e2e-map".to_owned(),
        "Live E2E Map".to_owned(),
        Some("Published to ephemeral LocalNode".to_owned()),
        geojson.to_owned(),
        vec!["e2e".to_owned()],
        vec![],
        None,
        None,
    )
    .expect("prepare map");
    let signed_json = sign_event_with_nsec(kp.nsec.clone(), unsigned.unsigned_event_json)
        .await
        .expect("sign map");

    // Verify naddr encode/decode round-trip for the published coordinate.
    let naddr = encode_naddr_coordinate(
        37_515,
        kp.pubkey_hex.clone(),
        "live-e2e-map".to_owned(),
        vec![relay_url.clone()],
        Some("pt-live".to_owned()),
    )
    .expect("encode naddr");
    let decoded = decode_naddr_coordinate(naddr).expect("decode naddr");
    assert_eq!(decoded.address, unsigned.address);
    assert_eq!(decoded.feature_id.as_deref(), Some("pt-live"));

    let outcome = publish_signed_event_via_outbox(
        outbox_db.display().to_string(),
        signed_json.clone(),
        vec![relay_url.clone()],
    )
    .await
    .expect("publish via outbox");
    assert_eq!(outcome.outbox_state, "delivered");
    assert!(outcome.relays[0].ok);
    assert_eq!(
        list_outbox_items(outbox_db.display().to_string())
            .expect("list outbox")
            .len(),
        1
    );

    // Fetch live from ephemeral LocalNode relay (also caches into NostrLMDB).
    let live_catalog = fetch_earthly_catalog(vec![relay_url.clone()], 20)
        .await
        .expect("fetch live catalog");
    assert!(
        live_catalog
            .maps
            .iter()
            .any(|m| m.d_tag == "live-e2e-map" && m.pubkey == kp.pubkey_hex && m.feature_count == 1)
    );

    // Shut down the ephemeral LocalNode relay so WebSocket becomes unreachable.
    node.shutdown();
    drop(node);

    // Offline fallback query must still serve the map from NostrLMDB!
    let offline_catalog = fetch_earthly_catalog(vec![relay_url], 20)
        .await
        .expect("offline NostrLMDB fallback catalog");
    assert!(
        offline_catalog
            .maps
            .iter()
            .any(|m| m.d_tag == "live-e2e-map" && m.pubkey == kp.pubkey_hex && m.title == "Live E2E Map")
    );

    // 2. Also verify the global FFI LocalNode + publish_nearby_event_via_outbox +
    //    fetch_local_node_catalog pipeline.
    let _ = shutdown_local_node();
    let snap = start_local_node(nearby_node_dir.display().to_string())
        .await
        .expect("start FFI local node");
    assert!(snap.running);

    let nearby_unsigned = prepare_unsigned_map_event(
        kp.pubkey_hex.clone(),
        "nearby-e2e-map".to_owned(),
        "Nearby Field Map".to_owned(),
        None,
        geojson.to_owned(),
        vec![],
        vec![],
        Some("field-session-e2e".to_owned()),
        None,
    )
    .expect("prepare nearby map");
    let nearby_signed = sign_event_with_nsec(kp.nsec, nearby_unsigned.unsigned_event_json)
        .await
        .expect("sign nearby map");
    let nearby_outcome = publish_nearby_event_via_outbox(
        nearby_outbox_db.display().to_string(),
        nearby_signed,
        vec![],
    )
    .await
    .expect("publish nearby via outbox");
    assert_eq!(nearby_outcome.outbox_state, "delivered");

    let local_catalog = fetch_local_node_catalog()
        .await
        .expect("fetch local node catalog");
    assert!(
        local_catalog
            .maps
            .iter()
            .any(|m| m.d_tag == "nearby-e2e-map" && m.pubkey == kp.pubkey_hex)
    );
    assert!(shutdown_local_node());
}

#[tokio::test]
async fn live_mcp_bridge_http_auth_and_drain_mutations_e2e() {
    let _ = stop_mcp_bridge().await;

    let initial_ws = McpWorkspaceDto {
        center_lon: 16.3738,
        center_lat: 48.2082,
        zoom: 13.0,
        draft_title: "Live MCP E2E".to_owned(),
        draft_geojson: r#"{"type":"FeatureCollection","features":[]}"#.to_owned(),
        shelf_map_titles: vec!["Danube Parks".to_owned()],
        atlas_workspaces: vec![],
        working_set_titles: vec![],
        catalog_items: vec![],
    };

    let started = start_mcp_bridge(0, initial_ws)
        .await
        .expect("start MCP bridge");
    assert!(started.running);
    assert!(started.port > 0);
    assert!(!started.auth_token.is_empty());

    let http = reqwest::Client::new();

    // Unauthenticated & wrong-token requests must be rejected with 401 Unauthorized.
    let no_auth = http
        .post(&started.endpoint_url)
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }))
        .send()
        .await
        .expect("unauth request");
    assert_eq!(no_auth.status(), StatusCode::UNAUTHORIZED);

    let bad_auth = http
        .post(&started.endpoint_url)
        .bearer_auth("invalid-token")
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }))
        .send()
        .await
        .expect("bad auth request");
    assert_eq!(bad_auth.status(), StatusCode::UNAUTHORIZED);

    // Valid Bearer token initializes and invokes tools that queue mutations.
    let init_resp = http
        .post(&started.endpoint_url)
        .bearer_auth(&started.auth_token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "clientInfo": { "name": "ffi-e2e-client", "version": "1.0" }
            }
        }))
        .send()
        .await
        .expect("initialize");
    assert_eq!(init_resp.status(), StatusCode::OK);

    let create_pt = http
        .post(&started.endpoint_url)
        .bearer_auth(&started.auth_token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "create_point",
                "arguments": {
                    "lon": 16.3738,
                    "lat": 48.2082,
                    "name": "Stephansdom"
                }
            }
        }))
        .send()
        .await
        .expect("create_point");
    assert_eq!(create_pt.status(), StatusCode::OK);
    let pt_body: Value = create_pt.json().await.expect("point json");
    assert_eq!(pt_body["result"]["isError"], false);

    let create_line = http
        .post(&started.endpoint_url)
        .bearer_auth(&started.auth_token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "create_line",
                "arguments": {
                    "name": "Ring Walk",
                    "coordinates": [[16.37, 48.20], [16.38, 48.21]]
                }
            }
        }))
        .send()
        .await
        .expect("create_line");
    assert_eq!(create_line.status(), StatusCode::OK);
    let line_body: Value = create_line.json().await.expect("line json");
    assert_eq!(line_body["result"]["isError"], false);

    // Drain pending mutations via FFI and verify geometry + camera payloads.
    let mutations = drain_mcp_mutations().await.expect("drain mutations");
    assert_eq!(mutations.len(), 2);
    assert_eq!(mutations[0].tool_name, "create_point");
    assert!(mutations[0].camera_action.is_some());
    assert_eq!(mutations[1].tool_name, "create_line");
    let updated_fc: Value = serde_json::from_str(
        mutations[1]
            .updated_draft_geojson
            .as_deref()
            .expect("updated geojson"),
    )
    .expect("valid geojson");
    assert_eq!(updated_fc["features"].as_array().map(Vec::len), Some(2));

    // Subsequent drain must be empty.
    assert!(
        drain_mcp_mutations()
            .await
            .expect("second drain")
            .is_empty()
    );

    // sync_mcp_workspace updates server state visible to get_map_state.
    sync_mcp_workspace(McpWorkspaceDto {
        center_lon: 16.38,
        center_lat: 48.21,
        zoom: 14.0,
        draft_title: "Synced Title".to_owned(),
        draft_geojson: updated_fc.to_string(),
        shelf_map_titles: vec![],
        atlas_workspaces: vec![],
        working_set_titles: vec![],
        catalog_items: vec![],
    })
    .await
    .expect("sync workspace");

    let state_resp = http
        .post(&started.endpoint_url)
        .bearer_auth(&started.auth_token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": { "name": "get_map_state", "arguments": {} }
        }))
        .send()
        .await
        .expect("get_map_state");
    let state_json: Value = state_resp.json().await.expect("state json");
    let state_payload: Value = serde_json::from_str(
        state_json["result"]["content"][0]["text"]
            .as_str()
            .expect("state text"),
    )
    .expect("state payload");
    assert_eq!(state_payload["draftTitle"], "Synced Title");
    assert_eq!(state_payload["draftFeatureCount"], 2);

    let status = get_mcp_bridge_status().await.expect("status");
    assert!(status.running);
    assert_eq!(status.total_calls, 3);

    let stopped = stop_mcp_bridge().await.expect("stop bridge");
    assert!(!stopped.running);
}

#[test]
fn geo_multipart_shapefile_and_csv_ffi_round_trips() {
    // 1. Multipart merge + explode for Points, LineStrings, and Polygons.
    let merged_points = geo_merge_to_multipart(vec![
        r#"{"type":"Point","coordinates":[16.37,48.20]}"#.to_owned(),
        r#"{"type":"Point","coordinates":[16.38,48.21]}"#.to_owned(),
    ])
    .expect("merge points");
    let mp_json: Value = serde_json::from_str(&merged_points).expect("parse MultiPoint");
    assert_eq!(mp_json["type"], "MultiPoint");
    assert_eq!(geo_explode_multipart(merged_points).expect("explode").len(), 2);

    let merged_polys = geo_merge_to_multipart(vec![
        r#"{"type":"Polygon","coordinates":[[[16.36,48.20],[16.37,48.20],[16.37,48.21],[16.36,48.21],[16.36,48.20]]]}"#.to_owned(),
        r#"{"type":"Polygon","coordinates":[[[16.38,48.20],[16.39,48.20],[16.39,48.21],[16.38,48.21],[16.38,48.20]]]}"#.to_owned(),
    ])
    .expect("merge polygons");
    let mpoly_json: Value = serde_json::from_str(&merged_polys).expect("parse MultiPolygon");
    assert_eq!(mpoly_json["type"], "MultiPolygon");
    assert_eq!(
        geo_explode_multipart(merged_polys)
            .expect("explode polygons")
            .len(),
        2
    );

    // 2. CSV import -> validate -> GPX/KML export -> Shapefile ZIP export -> Shapefile import.
    let csv_payload = "name,lat,lon,elevation\nBasecamp,48.2082,16.3738,171\nSummit,48.2500,16.4000,484\n";
    let csv_imported =
        geo_import_spatial_file("survey_waypoints.csv".to_owned(), csv_payload.to_owned())
            .expect("import CSV");
    assert_eq!(csv_imported.format, "csv");
    assert_eq!(csv_imported.feature_count, 2);

    let validation = geo_validate_draft_geojson(csv_imported.geojson.clone());
    assert!(validation.valid);
    assert_eq!(validation.feature_count, 2);

    let gpx = geo_export_gpx(csv_imported.geojson.clone(), Some("Survey".to_owned()))
        .expect("export GPX");
    assert!(gpx.contains("<wpt"));
    let kml = geo_export_kml(csv_imported.geojson.clone(), Some("Survey".to_owned()))
        .expect("export KML");
    assert!(kml.contains("<Placemark>"));

    let shp_zip = geo_export_shapefile_zip(csv_imported.geojson, Some("Survey".to_owned()))
        .expect("export shapefile zip");
    assert!(shp_zip.starts_with(b"PK\x03\x04"));

    let shp_imported = geo_import_shapefile_bytes(Some("survey.zip".to_owned()), shp_zip)
        .expect("reimport shapefile zip");
    assert_eq!(shp_imported.feature_count, 2);
    let shp_fc: Value = serde_json::from_str(&shp_imported.geojson).expect("valid geojson");
    assert_eq!(shp_fc["features"].as_array().map(Vec::len), Some(2));
}
