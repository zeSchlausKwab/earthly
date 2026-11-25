//! Canonical feature style properties and embedded `MapPresentationV1`
//! (`SPEC.md` §1.7 & `docs/MAP-WITH-A-MARGIN-SPEC.md` §16).

use serde::{Deserialize, Serialize};

/// Canonical per-feature style properties recognized by Earthly renderers.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureStyleProperties {
    pub color: Option<String>,
    pub fill_color: Option<String>,
    pub stroke_color: Option<String>,
    pub fill_opacity: Option<f64>,
    pub stroke_opacity: Option<f64>,
    pub stroke_width: Option<f64>,
    pub radius: Option<f64>,
    pub line_dash: Option<Vec<f64>>,
    pub label: Option<String>,
    pub display_icon: Option<String>,
}

impl FeatureStyleProperties {
    /// Extracts the Lucide icon name when `display_icon` uses the `lucide:`
    /// namespace (SPEC §1.7.1). Unknown namespaces safely return `None` so
    /// renderers fall back to a visible circle marker.
    pub fn lucide_icon_name(&self) -> Option<&str> {
        self.display_icon
            .as_deref()
            .and_then(|icon| icon.strip_prefix("lucide:"))
            .filter(|name| {
                !name.is_empty()
                    && name
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            })
    }
}

/// Embedded presentation metadata stored alongside authored maps & stories.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPresentationV1 {
    pub version: u8,
    pub theme: Option<String>,
    pub basemap_id: Option<String>,
    pub show_callouts: Option<bool>,
    pub center: Option<[f64; 2]>,
    pub zoom: Option<f64>,
}

impl Default for MapPresentationV1 {
    fn default() -> Self {
        Self {
            version: 1,
            theme: None,
            basemap_id: None,
            show_callouts: Some(true),
            center: None,
            zoom: None,
        }
    }
}
