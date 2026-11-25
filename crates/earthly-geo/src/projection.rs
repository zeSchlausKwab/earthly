//! Fast local tangent-plane metric projection (meters around a WGS84 origin).

use geo::{Coord, LineString, Polygon};

const METERS_PER_DEG_LAT: f64 = 111_319.490_793_273_57;

#[derive(Clone, Copy, Debug)]
pub struct LocalProjection {
    origin_lon: f64,
    origin_lat: f64,
    cos_lat: f64,
}

impl LocalProjection {
    pub fn from_origin(lon: f64, lat: f64) -> Self {
        Self {
            origin_lon: lon,
            origin_lat: lat,
            cos_lat: lat.to_radians().cos().abs().max(1e-6),
        }
    }

    pub fn from_coords<'a>(coords: impl IntoIterator<Item = &'a Coord<f64>>) -> Self {
        let mut sum_lon = 0.0;
        let mut sum_lat = 0.0;
        let mut count = 0usize;
        for c in coords {
            sum_lon += c.x;
            sum_lat += c.y;
            count += 1;
        }
        if count == 0 {
            Self::from_origin(0.0, 0.0)
        } else {
            Self::from_origin(sum_lon / count as f64, sum_lat / count as f64)
        }
    }

    pub fn forward(&self, coord: Coord<f64>) -> Coord<f64> {
        Coord {
            x: (coord.x - self.origin_lon) * METERS_PER_DEG_LAT * self.cos_lat,
            y: (coord.y - self.origin_lat) * METERS_PER_DEG_LAT,
        }
    }

    pub fn inverse(&self, xy: Coord<f64>) -> Coord<f64> {
        Coord {
            x: self.origin_lon + xy.x / (METERS_PER_DEG_LAT * self.cos_lat),
            y: self.origin_lat + xy.y / METERS_PER_DEG_LAT,
        }
    }

    pub fn forward_line(&self, line: &LineString<f64>) -> LineString<f64> {
        LineString::new(line.0.iter().map(|c| self.forward(*c)).collect())
    }

    pub fn inverse_line(&self, line: &LineString<f64>) -> LineString<f64> {
        LineString::new(line.0.iter().map(|c| self.inverse(*c)).collect())
    }

    pub fn forward_polygon(&self, poly: &Polygon<f64>) -> Polygon<f64> {
        let exterior = self.forward_line(poly.exterior());
        let interiors = poly
            .interiors()
            .iter()
            .map(|ring| self.forward_line(ring))
            .collect();
        Polygon::new(exterior, interiors)
    }

    pub fn inverse_polygon(&self, poly: &Polygon<f64>) -> Polygon<f64> {
        let exterior = self.inverse_line(poly.exterior());
        let interiors = poly
            .interiors()
            .iter()
            .map(|ring| self.inverse_line(ring))
            .collect();
        Polygon::new(exterior, interiors)
    }
}
