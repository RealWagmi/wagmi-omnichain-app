use crate::*;
use anchor_lang::prelude::*;
use oapp::{
    endpoint::{
        cpi::accounts::Clear,
        instructions::ClearParams,
        ConstructCPIContext, ID as ENDPOINT_ID,
    },
};
use anchor_spl::{associated_token::AssociatedToken, token_interface::Mint};
use anchor_spl::{token_interface::{TokenAccount, TokenInterface}};

#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceive<'info> {
    /// OApp Store PDA.  This account represents the "address" of your OApp on
    /// Solana and can contain any state relevant to your application.
    /// Customize the fields in `Store` as needed.
    #[account(mut, seeds = [GATEWAY_VAULT_SEED], bump = store.bump)]
    pub store: Account<'info, GatewayVault>,
    /// Peer config PDA for the sending chain. Ensures `params.sender` can only be the allowed peer from that remote chain.
    #[account(
        seeds = [PEER_SEED, &store.key().to_bytes(), &params.src_eid.to_be_bytes()],
        bump = peer.bump,
        constraint = params.sender == peer.peer_address
    )]
    pub peer: Account<'info, PeerConfig>,
    #[account(mut)]
    pub program_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub sender: AccountInfo<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>
}

impl LzReceive<'_> {
    pub fn apply(ctx: &mut Context<LzReceive>, params: &LzReceiveParams) -> Result<()> {
        // The OApp Store PDA is used to sign the CPI to the Endpoint program.
        let seeds: &[&[u8]] = &[GATEWAY_VAULT_SEED, &[ctx.accounts.store.bump]];

        // The first Clear::MIN_ACCOUNTS_LEN accounts were returned by
        // `lz_receive_types` and are required for Endpoint::clear
        let accounts_for_clear = &ctx.remaining_accounts[0..Clear::MIN_ACCOUNTS_LEN];
        // Call the Endpoint::clear CPI to clear the message from the Endpoint program.
        // This is necessary to ensure the message is processed only once and to
        // prevent replays.
        let _ = oapp::endpoint_cpi::clear(
            ENDPOINT_ID,
            ctx.accounts.store.key(),
            accounts_for_clear,
            seeds,
            ClearParams {
                receiver: ctx.accounts.store.key(),
                src_eid: params.src_eid,
                sender: params.sender,
                nonce: params.nonce,
                guid: params.guid,
                message: params.message.clone(),
            },
        )?;
        require(params.src_eid == ctx.accounts.store.dst_eid,WagmiError::WrongDstEid)?; 
        require(params.message.len() > 0,WagmiError::WrongMessage)?; 

        let message_type = params.message[0];
                if message_type == (MessageType::Withdraw as u8) || message_type == (MessageType::Swap as u8) {
                     let (_from, _to, asset) =   msg_codec::decode_proccess_message(&params.message[0..])?;

                     let seeds: &[&[&[u8]]] = &[
                        &[
                            GATEWAY_VAULT_SEED,
                            &[ctx.accounts.store.bump],
                        ]
                    ];
                     transfer_with_seeds(
                        &ctx.accounts.store.to_account_info(),
                        &ctx.accounts.mint_account,
                        &ctx.accounts.program_token_account,
                        &ctx.accounts.sender_token_account,
                        &ctx.accounts.token_program,
                        asset.token_amount as u64,
                        seeds
                     )?;
                }
                    else if message_type == MessageType::RevertSwap as u8 {
                        let (_from, _to, asset,_guid,_reason) =   msg_codec::decode_process_message_revert_swap(&params.message[0..])?;


                     let seeds: &[&[&[u8]]] = &[
                        &[
                            GATEWAY_VAULT_SEED,
                            &[ctx.accounts.store.bump],
                        ]
                    ];
                        transfer_with_seeds(
                            &ctx.accounts.store.to_account_info(),
                            &ctx.accounts.mint_account,
                            &ctx.accounts.program_token_account,
                            &ctx.accounts.sender_token_account,
                            &ctx.accounts.token_program,
                            asset.token_amount as u64,
                            seeds
                         )?;
                    }

        Ok(())
    }
}


#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct LzReceiveParams {
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub guid: [u8; 32],
    pub message: Vec<u8>,
    pub extra_data: Vec<u8>,
}