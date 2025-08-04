use crate::*;
use oapp::endpoint::{cpi::accounts::RegisterOApp, instructions::RegisterOAppParams};

#[derive(Accounts)]
#[instruction(params: InitGatewayVaultParams)]
pub struct InitGatewayVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = GatewayVault::SIZE,
        seeds = [GATEWAY_VAULT_SEED],
        bump
    )]
    pub gateway_vault: Account<'info, GatewayVault>,
    #[account(
        init,
        payer = payer,
        space = LzReceiveTypesAccounts::SIZE,
        seeds = [LZ_RECEIVE_TYPES_SEED, &gateway_vault.key().to_bytes()],
        bump
    )]
    pub lz_receive_types_accounts: Account<'info, LzReceiveTypesAccounts>,
  
    pub system_program: Program<'info, System>,
    /// CHECK: 
    pub event_authority_account: UncheckedAccount<'info>,
    /// CHECK: 
    pub enpoint_program: UncheckedAccount<'info>,
     /// CHECK: 
    #[account(mut)]
    pub oapp_registry: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
}

impl InitGatewayVault<'_> {
    pub fn apply(ctx: &mut Context<InitGatewayVault>, params: &InitGatewayVaultParams) -> Result<()> {
        ctx.accounts.gateway_vault.admin = params.admin;
        ctx.accounts.gateway_vault.bump = ctx.bumps.gateway_vault;
        ctx.accounts.gateway_vault.endpoint_program = params.endpoint;
        ctx.accounts.gateway_vault.dst_eid = params.dst_eid;
        ctx.accounts.gateway_vault.token_count = 1;
        ctx.accounts.gateway_vault.dst_address = params.receiver_address; 

        ctx.accounts.lz_receive_types_accounts.store = ctx.accounts.gateway_vault.key();
   

        let register_params = RegisterOAppParams { delegate: ctx.accounts.gateway_vault.admin };
       
        let seeds: &[&[u8]] = &[GATEWAY_VAULT_SEED, &[ctx.accounts.gateway_vault.bump]];

        let context = CpiContext::new (
            ctx.accounts.enpoint_program.to_account_info(),
            RegisterOApp {
                payer: ctx.accounts.payer.to_account_info(),
                oapp: ctx.accounts.gateway_vault.to_account_info(),
                oapp_registry: ctx.accounts.oapp_registry.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                event_authority: ctx.accounts.event_authority_account.to_account_info(),
                program: ctx.accounts.enpoint_program.to_account_info()
            });

  oapp::endpoint::cpi::register_oapp(context.with_signer(&[&seeds]), register_params)
  .map_err(anchor_lang::error::Error::from)?;

        Ok(())
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitGatewayVaultParams {
    pub admin: Pubkey,
    pub endpoint: Pubkey,
    pub receiver_address: [u8;32],
    pub dst_eid: u32,
}