use crate::{state::token::AvailableToken, *};
use anchor_lang::prelude::*;
use oapp::endpoint::{
    instructions::QuoteParams, state::EndpointSettings, MessagingFee, ENDPOINT_SEED, ID as ENDPOINT_ID
};

#[derive(Accounts)]
#[instruction(params: QuoteSendParams)]
pub struct QuoteSend<'info> {
    #[account(seeds = [GATEWAY_VAULT_SEED], bump = store.bump)]
    pub store: Account<'info, GatewayVault>,
    #[account(
    seeds = [
        PEER_SEED,
        store.key().as_ref(),
        &params.dst_eid.to_be_bytes()
    ],
    bump = peer.bump
    )]
    pub peer: Account<'info, PeerConfig>,
    #[account(seeds = [ENDPOINT_SEED], bump = endpoint.bump, seeds::program = ENDPOINT_ID)]
    pub endpoint: Account<'info, EndpointSettings>,
}

impl<'info> QuoteSend<'info> {
    pub fn apply(ctx: &Context<QuoteSend>, params: &QuoteSendParams) -> Result<MessagingFee> {
        let message = msg_codec::encode_available_token(&params.message)?;
        let mut message_type =  [0u8; 32];
        message_type[31] = MessageType::LinkToken as u8;
        let mut payload = message_type.to_vec();
        payload.extend_from_slice(&message);


        let quote_params = QuoteParams {
            sender: ctx.accounts.store.key(),
            dst_eid: params.dst_eid,
            receiver: params.receiver,
            message: payload,
            pay_in_lz_token: params.pay_in_lz_token,
            options: ctx
                .accounts
                .peer
                .enforced_options
                .combine_options(&None::<Vec<u8>>,&params.options)?,
        };
        oapp::endpoint_cpi::quote(ENDPOINT_ID, ctx.remaining_accounts, quote_params)
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct QuoteSendParams {
    pub dst_eid: u32,
    pub receiver: [u8; 32],
    pub message: AvailableToken,
    pub options: Vec<u8>,
    pub pay_in_lz_token: bool,
}