use crate::state::token::TokenIndex;
use crate::*;
use anchor_spl::token_interface::{Mint};

#[derive(Accounts)]
pub struct GetTokenIndex<'info> {
    #[account(seeds = [GATEWAY_VAULT_SEED], bump = store.bump)]
    pub store: Account<'info, GatewayVault>,
    #[account(
        seeds = [store.key().as_ref(), &mint_account.key().as_ref()],
        bump
    )]
    pub token_index_data: Account<'info, TokenIndex>,
    pub mint_account: InterfaceAccount<'info, Mint>,
}

impl GetTokenIndex<'_> {
    pub fn apply(
        ctx: &Context<GetTokenIndex>
    ) -> Result<u64> {
      Ok(ctx.accounts.token_index_data.index)
    }
}