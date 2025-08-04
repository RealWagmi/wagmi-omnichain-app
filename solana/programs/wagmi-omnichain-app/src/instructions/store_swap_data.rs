use crate::*;
 
#[derive(Accounts)]
#[instruction()]
pub struct StoreSwapData<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [GATEWAY_VAULT_SEED],
        bump
    )]
    pub gateway_vault: Account<'info, GatewayVault>,
    #[account(
        init,
        payer = payer,
        space = SwapStorage::SIZE,
        seeds = [gateway_vault.key().as_ref(), payer.key().as_ref()],
        bump
    )]
    pub swap_storage: Account<'info, SwapStorage>,
    pub system_program: Program<'info, System>
}

impl StoreSwapData<'_> {
    pub fn apply(ctx: &mut Context<StoreSwapData>, swap_params: SwapParams) -> Result<()> {
        ctx.accounts.swap_storage.assets = swap_params.assets;
        ctx.accounts.swap_storage.commands = swap_params.commands;
        ctx.accounts.swap_storage.dst_eid = swap_params.dst_eid;
        ctx.accounts.swap_storage.from = swap_params.from;
        ctx.accounts.swap_storage.gas_limit = swap_params.gas_limit;
        ctx.accounts.swap_storage.inputs = swap_params.inputs;
        ctx.accounts.swap_storage.minimum_amount_out = swap_params.minimum_amount_out;
        ctx.accounts.swap_storage.to = swap_params.to;
        ctx.accounts.swap_storage.value = swap_params.value;
        ctx.accounts.swap_storage.synthetic_token_out = swap_params.synthetic_token_out;
        Ok(())
    }
}