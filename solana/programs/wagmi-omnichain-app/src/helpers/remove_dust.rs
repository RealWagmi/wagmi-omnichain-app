pub fn remove_dust(amount: u128, decimals_delta: i8) -> u128 {
    if decimals_delta < 0 {
        let abs_decimals_delta = (-decimals_delta) as u32;
        let divisor = 10u128.pow(abs_decimals_delta);
        return (amount / divisor) * divisor;
    }
    amount
}