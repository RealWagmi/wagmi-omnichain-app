use crate::{state::token::{AvailableToken, TokenIndex}, *};
use oapp::endpoint::{instructions::{SendParams}, ID as ENDPOINT_ID};
use anchor_spl::token_interface::{Mint};

#[derive(Accounts)]
#[instruction(params: TokenSetupConfig)]
pub struct LinkTokenToHub<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [GATEWAY_VAULT_SEED],
        bump
    )]
    pub gateway_vault: Account<'info, GatewayVault>,
    #[account(
        init,
        payer = payer,
        space = AvailableToken::SIZE,
        seeds = [gateway_vault.key().as_ref(), &gateway_vault.token_count.to_be_bytes()],
        bump
    )]
    pub new_token_program_account: Account<'info, AvailableToken>,
    #[account(
        init,
        payer = payer,
        space = TokenIndex::SIZE,
        seeds = [gateway_vault.key().as_ref(), &mint_account.key().as_ref()],
        bump
    )]
    pub new_token_index_saver: Account<'info, TokenIndex>,
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

impl LinkTokenToHub<'_> {
    pub fn apply(ctx: &mut Context<LinkTokenToHub>, params: &TokenSetupConfig, native_token_fee: u64, options: Vec<u8>) -> Result<()> {
        require!(ctx.accounts.gateway_vault.admin == ctx.accounts.payer.key(), WagmiError::OnlyAdmin);
        let current_count = ctx.accounts.gateway_vault.token_count;
        ctx.accounts.new_token_index_saver.index = current_count;
        ctx.accounts.gateway_vault.token_count = current_count + 1;
        
 
  
        let token_decimals = ctx.accounts.mint_account.decimals;
       
        ctx.accounts.new_token_program_account.on_pause = params.on_pause;
        ctx.accounts.new_token_program_account.token_address = params.token_address.clone();
        ctx.accounts.new_token_program_account.synthetic_token_address =  params.synthetic_token_address.clone();
        ctx.accounts.new_token_program_account.decimals_delta =  params.synthetic_token_decimals as i8 - token_decimals as i8;
        ctx.accounts.new_token_program_account.min_bridge_amt =  params.min_bridge_amt;
        
        let available_token = AvailableToken 
        {
             on_pause: ctx.accounts.new_token_program_account.on_pause,
             token_address: ctx.accounts.new_token_program_account.token_address.clone(),
             synthetic_token_address: ctx.accounts.new_token_program_account.synthetic_token_address.clone(),
             decimals_delta:  ctx.accounts.new_token_program_account.decimals_delta,
             min_bridge_amt: ctx.accounts.new_token_program_account.min_bridge_amt 
            };
      

        let message = msg_codec::encode_available_token(&available_token)?;
        
        let mut message_type =  [0u8; 32];
        message_type[31] = MessageType::LinkToken as u8;
        let mut payload = message_type.to_vec();
        payload.extend_from_slice(&message);


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




#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TokenSetupConfig {
    pub on_pause: bool,
    pub token_address: Pubkey,
    pub synthetic_token_decimals: u8,
    pub synthetic_token_address: [u8;32],
    pub min_bridge_amt: u128,
}
