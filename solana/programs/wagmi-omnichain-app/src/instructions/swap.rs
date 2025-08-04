use crate::{state::token::{AvailableToken}, *};
use oapp::endpoint::{instructions::{SendParams}, ID as ENDPOINT_ID};
use anchor_spl::{associated_token::AssociatedToken, token_interface::Mint};
use anchor_spl::{token_interface::{TokenAccount, TokenInterface}};
 
#[derive(Accounts)]
#[instruction(token_index: u64)]
pub struct Swap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [GATEWAY_VAULT_SEED],
        bump
    )]
    pub gateway_vault: Account<'info, GatewayVault>,
    #[account(
        seeds = [gateway_vault.key().as_ref(), &token_index.to_be_bytes()],
        bump
    )]
    pub token_program_account: Account<'info, AvailableToken>,
    pub mint_account: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_account,
        associated_token::authority = gateway_vault)]
    pub program_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub swap_storage: Account<'info, SwapStorage>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl Swap<'_> {
    pub fn apply(ctx: &mut Context<Swap>, token_index: u64, asset: Asset, native_token_fee: u64, options: Vec<u8>) -> Result<()> {
            let swap_params = SwapParams {
                from: ctx.accounts.swap_storage.from,
                to: ctx.accounts.swap_storage.to,
                synthetic_token_out: ctx.accounts.swap_storage.synthetic_token_out,
                gas_limit: ctx.accounts.swap_storage.gas_limit,
                dst_eid: ctx.accounts.swap_storage.dst_eid,
                value: ctx.accounts.swap_storage.value,
                assets: ctx.accounts.swap_storage.assets.clone(), 
                commands: ctx.accounts.swap_storage.commands.clone(),
                inputs: ctx.accounts.swap_storage.inputs.clone(),   
                minimum_amount_out: ctx.accounts.swap_storage.minimum_amount_out,
            };
            let transformed_asset = check_and_transform(&ctx.accounts.token_program_account, &asset)?;
            let mut swap_params= swap_params;

            swap_params.from = ctx.accounts.payer.key();
            swap_params.assets = transformed_asset;
            let amount = asset.token_amount;

            let deposit_data = encode_swap_params(&swap_params)?;

            let mut message_type =  [0u8; 32];
            message_type[31] = MessageType::Swap as u8;
            let mut payload = message_type.to_vec();
            payload.extend_from_slice(&deposit_data);

            transfer(
                &ctx.accounts.payer,
                &ctx.accounts.mint_account,
                &ctx.accounts.sender_token_account,
                &ctx.accounts.program_token_account,
               &ctx.accounts.token_program,
               amount as u64
            )?;
            let send_params = SendParams {
                dst_eid: ctx.accounts.gateway_vault.dst_eid,
                receiver: ctx.accounts.gateway_vault.dst_address,
                message: payload,
                options,
                native_fee: native_token_fee,
                lz_token_fee: 0,
            };
            
            let seeds: &[&[u8]] = &[GATEWAY_VAULT_SEED, &[ctx.accounts.gateway_vault.bump]];
            oapp::endpoint_cpi::send(
                ENDPOINT_ID,
                ctx.accounts.gateway_vault.key(),
                ctx.remaining_accounts,
                seeds,
                send_params,
            )?;
            close(ctx.accounts.swap_storage.to_account_info(), ctx.accounts.payer.to_account_info())?;
            Ok(())







    }
}


pub fn close<'info>(account_to_close: AccountInfo<'info>, destination: AccountInfo<'info>) -> Result<()> {
    let dest_starting_lamports = destination.lamports();

    **destination.lamports.borrow_mut() = dest_starting_lamports
        .checked_add(account_to_close.to_account_info().lamports())
        .unwrap();
    **account_to_close.to_account_info().lamports.borrow_mut() = 0;

    Ok(())
}