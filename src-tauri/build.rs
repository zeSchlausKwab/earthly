use std::path::PathBuf;

const MAPNOLIA_TRUSTED_PUBKEYS: &str = "MAPNOLIA_TRUSTED_PUBKEYS";
const EMBEDDED_MAPNOLIA_TRUSTED_PUBKEYS: &str = "EARTHLY_MAPNOLIA_TRUSTED_PUBKEYS";

fn validate_pubkey_list(value: &str) -> Result<&str, String> {
    let pubkeys = value
        .split(',')
        .map(str::trim)
        .filter(|pubkey| !pubkey.is_empty())
        .collect::<Vec<_>>();
    if pubkeys.is_empty()
        || pubkeys.iter().any(|pubkey| {
            pubkey.len() != 64
                || !pubkey
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
    {
        return Err(format!(
            "{MAPNOLIA_TRUSTED_PUBKEYS} must contain comma-separated lowercase 64-character public keys"
        ));
    }
    Ok(value)
}

fn configured_mapnolia_pubkeys() -> Result<String, String> {
    if let Ok(value) = std::env::var(MAPNOLIA_TRUSTED_PUBKEYS) {
        return validate_pubkey_list(&value).map(str::to_owned);
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR")
            .map_err(|_| "CARGO_MANIFEST_DIR is unavailable".to_owned())?,
    );
    let release_config = manifest_dir.join("../config/android-release.env");
    let contents = std::fs::read_to_string(&release_config).map_err(|error| {
        format!(
            "could not read native public configuration {}: {error}",
            release_config.display()
        )
    })?;
    let prefix = format!("{MAPNOLIA_TRUSTED_PUBKEYS}=");
    let mut matches = contents
        .lines()
        .map(str::trim)
        .filter_map(|line| line.strip_prefix(&prefix));
    let value = matches.next().ok_or_else(|| {
        format!("native public configuration is missing {MAPNOLIA_TRUSTED_PUBKEYS}")
    })?;
    if matches.next().is_some() {
        return Err(format!(
            "native public configuration defines {MAPNOLIA_TRUSTED_PUBKEYS} more than once"
        ));
    }
    validate_pubkey_list(value).map(str::to_owned)
}

fn main() {
    println!("cargo:rerun-if-env-changed={MAPNOLIA_TRUSTED_PUBKEYS}");
    println!("cargo:rerun-if-changed=../config/android-release.env");
    let trusted_pubkeys = configured_mapnolia_pubkeys()
        .unwrap_or_else(|error| panic!("invalid native Mapnolia trust configuration: {error}"));
    println!("cargo:rustc-env={EMBEDDED_MAPNOLIA_TRUSTED_PUBKEYS}={trusted_pubkeys}");
    tauri_build::build()
}
