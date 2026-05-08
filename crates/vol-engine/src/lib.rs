pub fn svi_total_variance(a: f64, b: f64, rho: f64, m: f64, sigma: f64, log_moneyness: f64) -> f64 {
    let centered = log_moneyness - m;
    let curvature = (centered * centered + sigma * sigma).sqrt();
    (a + b * (rho * centered + curvature)).max(0.0001)
}

#[cfg(test)]
mod tests {
    use super::svi_total_variance;

    #[test]
    fn variance_is_positive() {
        let value = svi_total_variance(0.012, 0.18, -0.24, 0.02, 0.42, 0.0);
        assert!(value > 0.0);
    }
}
