use crate::{state::token::{AvailableToken}, *};
use oapp::endpoint::{instructions::{SendParams}, ID as ENDPOINT_ID};
use anchor_spl::{associated_token::AssociatedToken, token_interface::Mint};
use anchor_spl::{token_interface::{TokenAccount, TokenInterface}};
 
#[derive(Accounts)]
#[instruction(token_index: u64)]
pub struct Deposit<'info> {
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
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl Deposit<'_> {
    pub fn apply(ctx: &mut Context<Deposit>, token_index: u64, asset: Asset, recepient: [u8; 32],  native_token_fee: u64, options: Vec<u8>) -> Result<()> {
            let transformed_asset = check_and_transform(&ctx.accounts.token_program_account, &asset)?;
            let deposit_data = encode_deposit(*ctx.accounts.payer.key, recepient, &asset)?;


            let mut message_type =  [0u8; 32];
            message_type[31] = MessageType::Deposit as u8;
            let mut payload = message_type.to_vec();
            payload.extend_from_slice(&deposit_data);

            transfer(
                &ctx.accounts.payer,
                &ctx.accounts.mint_account,
                &ctx.accounts.sender_token_account,
                &ctx.accounts.program_token_account,
               &ctx.accounts.token_program,
                transformed_asset.token_amount as u64
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
            Ok(())







    }
}