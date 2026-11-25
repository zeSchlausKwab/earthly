//! Cross-implementation interop helper exercising Earthly Web (`ts-mls`) <-> Rust (`earthly-mls`).
use earthly_mls::envelope::{create_private_envelope, LocalKeysSigner, NostrEventSigner};
use earthly_mls::invitation::{
    create_private_map_invitation, decode_private_map_invitation, format_circle_invite_url,
};
use earthly_mls::mls::{
    add_workspace_member, create_workspace_application_message, create_workspace_group,
    decode_raw_key_package_as_message, generate_mls_key_package, is_cordn_last_resort_key_package,
    join_workspace_group, open_coordinator_payload, process_workspace_message,
    seal_coordinator_payload, GeneratedKeyPackage, PersistedMlsState, ProcessedMlsMessage,
};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("");
    let input_str = std::io::read_to_string(std::io::stdin()).unwrap_or_default();
    let input: serde_json::Value =
        serde_json::from_str(if input_str.trim().is_empty() { "{}" } else { &input_str })
            .expect("stdin JSON");

    let output = match cmd {
        "gen_kp" => {
            let nsec = input["nsec"].as_str().unwrap();
            let signer = LocalKeysSigner::from_nsec_or_hex(nsec).unwrap();
            let kp = generate_mls_key_package(&signer.pubkey_hex(), true).unwrap();
            serde_json::to_value(kp).unwrap()
        }
        "join_and_reply" => {
            let nsec = input["nsec"].as_str().unwrap();
            let signer = LocalKeysSigner::from_nsec_or_hex(nsec).unwrap();
            let kp: GeneratedKeyPackage = serde_json::from_value(input["kp"].clone()).unwrap();
            let welcome_64 = input["welcome64"].as_str().unwrap();
            let web_sealed = input["webSealed"].as_str().unwrap();
            let admin_pk = input["adminPk"].as_str().unwrap();

            let state = join_workspace_group(welcome_64, &kp).unwrap();
            let opened = open_coordinator_payload(&state, web_sealed).unwrap();
            let (state2, received_text) =
                match process_workspace_message(&state, &opened, &[admin_pk.to_owned()]).unwrap() {
                    ProcessedMlsMessage::ApplicationMessage {
                        new_state,
                        envelope,
                    } => (new_state, envelope.content),
                    other => panic!("Expected ApplicationMessage, got {other:?}"),
                };

            let reply_env = create_private_envelope(
                &signer,
                &state2.group_id,
                37_515,
                r#"{"type":"FeatureCollection","name":"From Rust","features":[]}"#.to_owned(),
                vec![
                    vec!["d".to_owned(), "rust-map".to_owned()],
                    vec!["name".to_owned(), "From Rust".to_owned()],
                ],
                None,
            )
            .await
            .unwrap();
            let out = create_workspace_application_message(
                &state2,
                &reply_env,
                false,
                &[admin_pk.to_owned()],
            )
            .unwrap();
            let rust_sealed = seal_coordinator_payload(&state2, &out.message_64).unwrap();
            serde_json::json!({
                "receivedFromWeb": received_text,
                "rustSealed": rust_sealed,
                "groupId": state2.group_id,
            })
        }
        "create_and_add_web" => {
            let nsec = input["nsec"].as_str().unwrap();
            let signer = LocalKeysSigner::from_nsec_or_hex(nsec).unwrap();
            let pk = signer.pubkey_hex();
            let web_kp_64 = input["webKp64"].as_str().unwrap();
            let (decoded_kp, _) = decode_raw_key_package_as_message(web_kp_64).unwrap();
            let last_resort = is_cordn_last_resort_key_package(&decoded_kp);

            let ws_id = "ws-rust-interop";
            let group_id = "earthly:rust-to-web";
            let inv_tok = create_private_map_invitation(
                &signer,
                ws_id,
                group_id,
                &pk,
                &pk,
                &["wss://relay.earthly.city".to_owned()],
                "nonce123",
                1_750_000_000,
                None,
            )
            .await
            .unwrap();
            let inv_url = format_circle_invite_url(ws_id, &inv_tok);

            let state0 = create_workspace_group(group_id, &pk).unwrap();
            let added = add_workspace_member(&state0, web_kp_64, &[pk.clone()]).unwrap();
            let msg_env = create_private_envelope(
                &signer,
                group_id,
                9,
                "Hello from Rust mls-rs!".to_owned(),
                vec![],
                None,
            )
            .await
            .unwrap();
            let out = create_workspace_application_message(
                &added.new_state,
                &msg_env,
                false,
                &[pk.clone()],
            )
            .unwrap();
            let sealed = seal_coordinator_payload(&added.new_state, &out.message_64).unwrap();
            serde_json::json!({
                "webKpLastResort": last_resort,
                "inviteUrl": inv_url,
                "welcome64": added.welcome_64,
                "rustSealed": sealed,
                "rustState": out.new_state,
            })
        }
        "verify_web_invite_and_reply" => {
            let web_invite = input["webInviteToken"].as_str().unwrap();
            let decoded = decode_private_map_invitation(web_invite).unwrap();
            let state: PersistedMlsState =
                serde_json::from_value(input["rustState"].clone()).unwrap();
            let web_reply_sealed = input["webReplySealed"].as_str().unwrap();
            let admin_pk = input["adminPk"].as_str().unwrap();
            let opened = open_coordinator_payload(&state, web_reply_sealed).unwrap();
            let received =
                match process_workspace_message(&state, &opened, &[admin_pk.to_owned()]).unwrap() {
                    ProcessedMlsMessage::ApplicationMessage { envelope, .. } => envelope.content,
                    other => panic!("Expected ApplicationMessage, got {other:?}"),
                };
            serde_json::json!({
                "decodedInviteGroupId": decoded.group_id,
                "receivedFromWeb": received,
            })
        }
        _ => panic!("unknown cmd"),
    };
    println!("{}", serde_json::to_string(&output).unwrap());
}
