use vol_engine::svi_total_variance;

fn main() {
    let variance = svi_total_variance(0.012, 0.18, -0.24, 0.02, 0.42, 0.0);
    println!("{{\"sviTotalVariance\":{variance:.6}}}");
}
