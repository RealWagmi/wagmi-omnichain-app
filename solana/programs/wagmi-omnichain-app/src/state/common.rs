use crate::*;

pub enum MessageType {
    Deposit,
    Withdraw,
    Swap,
    LinkToken,
    RevertSwap
}


#[derive(Clone, Default, AnchorSerialize, AnchorDeserialize)]
pub struct Asset {
   pub token_address: Pubkey,
   pub token_amount: u128,
}