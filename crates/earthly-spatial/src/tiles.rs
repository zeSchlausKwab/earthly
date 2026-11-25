use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::Bounds;

/// Exact byte length of a PMTiles v3 header.
pub const PMTILES_V3_HEADER_LEN: usize = 127;
const PMTILES_MAGIC: &[u8; 7] = b"PMTiles";
const PMTILES_VERSION_3: u8 = 3;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub struct TileCoord {
    pub z: u8,
    pub x: u32,
    pub y: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TileFormat {
    Mvt,
    Png,
    Jpeg,
    Webp,
    Avif,
    AtlasVector,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileMetadata {
    pub id: String,
    pub format: TileFormat,
    pub min_zoom: u8,
    pub max_zoom: u8,
    pub bounds: Bounds,
    pub center: Option<[f64; 3]>,
    pub attribution: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TilePayload {
    pub format: TileFormat,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum TileSourceError {
    #[error("tile not found at {z}/{x}/{y}", z = .0.z, x = .0.x, y = .0.y)]
    NotFound(TileCoord),
    #[error("tile source I/O failed: {0}")]
    Io(String),
    #[error("invalid tile archive: {0}")]
    InvalidArchive(String),
}

/// Source-agnostic tile provider implemented by local/remote PMTiles archives
/// today and `.atlas` packages in the future.
pub trait TileSource: Send + Sync {
    fn metadata(&self) -> &TileMetadata;
    fn read_tile(&self, coord: TileCoord) -> Result<Option<TilePayload>, TileSourceError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PmtilesCompression {
    Unknown,
    None,
    Gzip,
    Brotli,
    Zstd,
}

impl PmtilesCompression {
    fn from_byte(byte: u8) -> Result<Self, PmtilesHeaderError> {
        match byte {
            0 => Ok(Self::Unknown),
            1 => Ok(Self::None),
            2 => Ok(Self::Gzip),
            3 => Ok(Self::Brotli),
            4 => Ok(Self::Zstd),
            other => Err(PmtilesHeaderError::UnknownCompression(other)),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PmtilesTileType {
    Unknown,
    Mvt,
    Png,
    Jpeg,
    Webp,
    Avif,
}

impl PmtilesTileType {
    fn from_byte(byte: u8) -> Result<Self, PmtilesHeaderError> {
        match byte {
            0 => Ok(Self::Unknown),
            1 => Ok(Self::Mvt),
            2 => Ok(Self::Png),
            3 => Ok(Self::Jpeg),
            4 => Ok(Self::Webp),
            5 => Ok(Self::Avif),
            other => Err(PmtilesHeaderError::UnknownTileType(other)),
        }
    }

    pub fn to_tile_format(self) -> TileFormat {
        match self {
            Self::Unknown => TileFormat::Unknown,
            Self::Mvt => TileFormat::Mvt,
            Self::Png => TileFormat::Png,
            Self::Jpeg => TileFormat::Jpeg,
            Self::Webp => TileFormat::Webp,
            Self::Avif => TileFormat::Avif,
        }
    }
}

/// Parsed PMTiles v3 binary header (127 bytes, little-endian).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PmtilesHeader {
    pub root_dir_offset: u64,
    pub root_dir_bytes: u64,
    pub json_metadata_offset: u64,
    pub json_metadata_bytes: u64,
    pub leaf_dirs_offset: u64,
    pub leaf_dirs_bytes: u64,
    pub tile_data_offset: u64,
    pub tile_data_bytes: u64,
    pub addressed_tiles_count: u64,
    pub tile_entries_count: u64,
    pub tile_contents_count: u64,
    pub clustered: bool,
    pub internal_compression: PmtilesCompression,
    pub tile_compression: PmtilesCompression,
    pub tile_type: PmtilesTileType,
    pub min_zoom: u8,
    pub max_zoom: u8,
    pub bounds: Bounds,
    pub center_zoom: u8,
    pub center_lon: f64,
    pub center_lat: f64,
}

impl PmtilesHeader {
    pub fn parse(bytes: &[u8]) -> Result<Self, PmtilesHeaderError> {
        if bytes.len() < PMTILES_V3_HEADER_LEN {
            return Err(PmtilesHeaderError::Truncated(bytes.len()));
        }
        if &bytes[0..7] != PMTILES_MAGIC {
            return Err(PmtilesHeaderError::InvalidMagic);
        }
        if bytes[7] != PMTILES_VERSION_3 {
            return Err(PmtilesHeaderError::UnsupportedVersion(bytes[7]));
        }

        let read_u64 = |offset: usize| -> u64 {
            u64::from_le_bytes(bytes[offset..offset + 8].try_into().expect("8-byte slice"))
        };
        let read_e7 = |offset: usize| -> f64 {
            let raw =
                i32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("4-byte slice"));
            f64::from(raw) / 10_000_000.0
        };

        let min_zoom = bytes[100];
        let max_zoom = bytes[101];
        if min_zoom > max_zoom {
            return Err(PmtilesHeaderError::InvalidZoomRange { min_zoom, max_zoom });
        }

        let bounds = Bounds::new(read_e7(102), read_e7(106), read_e7(110), read_e7(114))
            .map_err(|_| PmtilesHeaderError::InvalidBounds)?;

        Ok(Self {
            root_dir_offset: read_u64(8),
            root_dir_bytes: read_u64(16),
            json_metadata_offset: read_u64(24),
            json_metadata_bytes: read_u64(32),
            leaf_dirs_offset: read_u64(40),
            leaf_dirs_bytes: read_u64(48),
            tile_data_offset: read_u64(56),
            tile_data_bytes: read_u64(64),
            addressed_tiles_count: read_u64(72),
            tile_entries_count: read_u64(80),
            tile_contents_count: read_u64(88),
            clustered: bytes[96] == 1,
            internal_compression: PmtilesCompression::from_byte(bytes[97])?,
            tile_compression: PmtilesCompression::from_byte(bytes[98])?,
            tile_type: PmtilesTileType::from_byte(bytes[99])?,
            min_zoom,
            max_zoom,
            bounds,
            center_zoom: bytes[118],
            center_lon: read_e7(119),
            center_lat: read_e7(123),
        })
    }

    pub fn to_metadata(&self, id: impl Into<String>) -> TileMetadata {
        TileMetadata {
            id: id.into(),
            format: self.tile_type.to_tile_format(),
            min_zoom: self.min_zoom,
            max_zoom: self.max_zoom,
            bounds: self.bounds,
            center: Some([self.center_lon, self.center_lat, f64::from(self.center_zoom)]),
            attribution: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum PmtilesHeaderError {
    #[error("PMTiles header truncated: expected at least 127 bytes, got {0}")]
    Truncated(usize),
    #[error("invalid PMTiles magic bytes")]
    InvalidMagic,
    #[error("unsupported PMTiles version: {0}")]
    UnsupportedVersion(u8),
    #[error("unknown PMTiles compression code: {0}")]
    UnknownCompression(u8),
    #[error("unknown PMTiles tile type code: {0}")]
    UnknownTileType(u8),
    #[error("invalid zoom range: min {min_zoom} > max {max_zoom}")]
    InvalidZoomRange { min_zoom: u8, max_zoom: u8 },
    #[error("invalid geographic bounds in PMTiles header")]
    InvalidBounds,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_pmtiles_header() -> [u8; PMTILES_V3_HEADER_LEN] {
        let mut bytes = [0u8; PMTILES_V3_HEADER_LEN];
        bytes[0..7].copy_from_slice(b"PMTiles");
        bytes[7] = 3;
        bytes[8..16].copy_from_slice(&127u64.to_le_bytes()); // root_dir_offset
        bytes[16..24].copy_from_slice(&256u64.to_le_bytes()); // root_dir_bytes
        bytes[96] = 1; // clustered
        bytes[97] = 2; // gzip internal
        bytes[98] = 2; // gzip tile
        bytes[99] = 1; // MVT
        bytes[100] = 0; // min_zoom
        bytes[101] = 14; // max_zoom
        bytes[102..106].copy_from_slice(&(161_800_000i32).to_le_bytes()); // 16.18
        bytes[106..110].copy_from_slice(&(481_100_000i32).to_le_bytes()); // 48.11
        bytes[110..114].copy_from_slice(&(165_800_000i32).to_le_bytes()); // 16.58
        bytes[114..118].copy_from_slice(&(483_200_000i32).to_le_bytes()); // 48.32
        bytes[118] = 12;
        bytes[119..123].copy_from_slice(&(163_738_000i32).to_le_bytes());
        bytes[123..127].copy_from_slice(&(482_082_000i32).to_le_bytes());
        bytes
    }

    #[test]
    fn parses_valid_pmtiles_v3_header() {
        let raw = synthetic_pmtiles_header();
        let header = PmtilesHeader::parse(&raw).expect("valid PMTiles v3 header");

        assert_eq!(header.root_dir_offset, 127);
        assert_eq!(header.root_dir_bytes, 256);
        assert!(header.clustered);
        assert_eq!(header.internal_compression, PmtilesCompression::Gzip);
        assert_eq!(header.tile_type, PmtilesTileType::Mvt);
        assert_eq!(header.min_zoom, 0);
        assert_eq!(header.max_zoom, 14);
        assert!((header.bounds.west - 16.18).abs() < 1e-6);
        assert!((header.center_lat - 48.2082).abs() < 1e-6);

        let meta = header.to_metadata("vienna.pmtiles");
        assert_eq!(meta.format, TileFormat::Mvt);
        assert_eq!(meta.max_zoom, 14);
    }

    #[test]
    fn rejects_invalid_magic_and_version() {
        let mut raw = synthetic_pmtiles_header();
        raw[0] = b'X';
        assert_eq!(PmtilesHeader::parse(&raw), Err(PmtilesHeaderError::InvalidMagic));

        let mut raw = synthetic_pmtiles_header();
        raw[7] = 2;
        assert_eq!(
            PmtilesHeader::parse(&raw),
            Err(PmtilesHeaderError::UnsupportedVersion(2))
        );
    }
}
