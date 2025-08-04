use crate::{state::token::{AvailableToken, TokenIndex}, *};
use anchor_spl::token_interface::{Mint};

#[derive(Accounts)]
#[instruction()]
pub struct PauseToken<'info> {
    #[account(mut, constraint = admin.key() == gateway_vault.admin)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [GATEWAY_VAULT_SEED],
        bump
    )]
    pub gateway_vault: Account<'info, GatewayVault>,
    #[account(
        seeds = [gateway_vault.key().as_ref(), &token_index_account.index.to_be_bytes()],
        bump
    )]
    pub token_program_account: Account<'info, AvailableToken>,
    #[account(
        seeds = [gateway_vault.key().as_ref(), &mint_account.key().as_ref()],
        bump
    )]
    pub token_index_account: Account<'info, TokenIndex>,
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

impl PauseToken<'_> {
    pub fn apply(ctx: &mut Context<PauseToken>, on_pause: bool) -> Result<()> {
        ctx.accounts.token_program_account.on_pause = on_pause;
        Ok(())
    }
}