use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Geographic WGS84 bounding box (`[west, south, east, north]`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

impl Bounds {
    pub fn new(west: f64, south: f64, east: f64, north: f64) -> Result<Self, BoundsError> {
        let bounds = Self {
            west,
            south,
            east,
            north,
        };
        bounds.validate()?;
        Ok(bounds)
    }

    pub fn validate(&self) -> Result<(), BoundsError> {
        if !self.west.is_finite()
            || !self.south.is_finite()
            || !self.east.is_finite()
            || !self.north.is_finite()
        {
            return Err(BoundsError::NonFinite);
        }
        if !(-180.0..=180.0).contains(&self.west) || !(-180.0..=180.0).contains(&self.east) {
            return Err(BoundsError::LongitudeOutOfRange);
        }
        if !(-90.0..=90.0).contains(&self.south) || !(-90.0..=90.0).contains(&self.north) {
            return Err(BoundsError::LatitudeOutOfRange);
        }
        if self.west > self.east || self.south > self.north {
            return Err(BoundsError::Inverted);
        }
        Ok(())
    }

    pub fn contains_point(&self, lon: f64, lat: f64) -> bool {
        lon >= self.west && lon <= self.east && lat >= self.south && lat <= self.north
    }

    pub fn intersects(&self, other: &Self) -> bool {
        self.west <= other.east
            && self.east >= other.west
            && self.south <= other.north
            && self.north >= other.south
    }

    pub fn lon_span(&self) -> f64 {
        self.east - self.west
    }

    pub fn lat_span(&self) -> f64 {
        self.north - self.south
    }

    pub fn as_array(&self) -> [f64; 4] {
        [self.west, self.south, self.east, self.north]
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum BoundsError {
    #[error("bounds coordinates must be finite numbers")]
    NonFinite,
    #[error("longitude must be within [-180, 180]")]
    LongitudeOutOfRange,
    #[error("latitude must be within [-90, 90]")]
    LatitudeOutOfRange,
    #[error("bounds must satisfy west <= east and south <= north")]
    Inverted,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_tests_intersections() {
        let vienna = Bounds::new(16.18, 48.11, 16.58, 48.32).unwrap();
        assert!(vienna.contains_point(16.3738, 48.2082));
        assert!(!vienna.contains_point(13.4050, 52.5200));

        let inner = Bounds::new(16.30, 48.18, 16.42, 48.24).unwrap();
        assert!(vienna.intersects(&inner));

        assert_eq!(Bounds::new(17.0, 48.0, 16.0, 49.0), Err(BoundsError::Inverted));
        assert_eq!(
            Bounds::new(-181.0, 0.0, 0.0, 10.0),
            Err(BoundsError::LongitudeOutOfRange)
        );
        assert_eq!(
            Bounds::new(0.0, -91.0, 10.0, 10.0),
            Err(BoundsError::LatitudeOutOfRange)
        );
    }
}
