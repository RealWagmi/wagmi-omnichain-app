use crate::*;
use anchor_lang::prelude::*;


#[derive(Accounts)]
#[instruction()]
pub struct GetAvailableTokenLen<'info> {
    #[account(seeds = [GATEWAY_VAULT_SEED], bump = store.bump)]
    pub store: Account<'info, GatewayVault>,
}

impl<'info> GetAvailableTokenLen<'info> {
    pub fn apply(ctx: &Context<GetAvailableTokenLen>,) -> Result<u64> {
        Ok(ctx.accounts.store.token_count)
    }
}