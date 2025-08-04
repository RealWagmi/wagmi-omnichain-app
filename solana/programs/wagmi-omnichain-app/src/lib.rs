mod state;
mod instructions;
mod errors;
mod helpers;

use anchor_lang::prelude::*;
use instructions::*;
use state::*;
use errors::*;
use helpers::*;
use oapp::endpoint::MessagingFee;
use oapp::endpoint_cpi::LzAccount;

use crate::{instructions::{InitGatewayVault, InitGatewayVaultParams}, state::token::AvailableToken};
declare_id!("CRSGM9F6JqGCuJo81uXRNDNK1KgZH9QLe2yyqW8dQMjG");

const LZ_RECEIVE_TYPES_SEED: &[u8] = b"LzReceiveTypes"; 
const GATEWAY_VAULT_SEED: &[u8] = b"GatewayVault";
const PEER_SEED: &[u8] = b"Peer";

#[program]
pub mod wagmi_omnichain_app {

    use super::*;

    pub fn init_gateway_vault(mut ctx: Context<InitGatewayVault>, params: InitGatewayVaultParams) -> Result<()> {
        InitGatewayVault::apply(&mut ctx, &params)
    }

    pub fn quote_send(mut ctx: Context<QuoteSend>, params: QuoteSendParams) -> Result<MessagingFee> {
        QuoteSend::apply(&mut ctx, &params)
    }

    pub fn quote_deposit(mut ctx: Context<QuoteDeposit>, params: QuoteDepositParams)-> Result<MessagingFee> {
        QuoteDeposit::apply(&mut ctx, &params)
    }

    pub fn quote_swap(mut ctx: Context<QuoteSwap>, params: QuoteSwapParams)-> Result<MessagingFee> {
        QuoteSwap::apply(&mut ctx, &params)
    }

    pub fn set_peer_config(mut ctx: Context<SetPeerConfig>, params: SetPeerConfigParams) -> Result<()> {
        SetPeerConfig::apply(&mut ctx, &params)
    }

    pub fn pause_token(mut ctx: Context<PauseToken>, on_pause: bool) -> Result<()> {
        PauseToken::apply(&mut ctx, on_pause)
    }

    pub fn link_token_to_hub(
        mut ctx: Context<LinkTokenToHub>,
        params: TokenSetupConfig,
        native_token_fee: u64,
        options: Vec<u8>,
    ) -> Result<()> {
        LinkTokenToHub::apply(&mut ctx, &params, native_token_fee, options)
    }

    pub fn deposit(
        mut ctx: Context<Deposit>,
        token_index: u64,
        asset: Asset,
        recepient: [u8; 32],
        native_token_fee: u64,
        options: Vec<u8>) -> Result<()> {
        Deposit::apply(&mut ctx, token_index, asset, recepient, native_token_fee, options)
    }

    pub fn swap(
        mut ctx: Context<Swap>,
        token_index: u64,
        asset: Asset,
        native_token_fee: u64,
        options: Vec<u8>) -> Result<()> {
        Swap::apply(&mut ctx, token_index, asset, native_token_fee, options)
    }

    pub fn store_swap_data(mut ctx: Context<StoreSwapData>, swap_params: SwapParams)-> Result<()> {
        StoreSwapData::apply(&mut ctx, swap_params)
    }

    pub fn lz_receive(mut ctx: Context<LzReceive>, params: LzReceiveParams) -> Result<()> {
        LzReceive::apply(&mut ctx, &params)
    }

    pub fn lz_receive_types(
        ctx: Context<LzReceiveTypes>,
        params: LzReceiveParams,
    ) -> Result<Vec<LzAccount>> {
        LzReceiveTypes::apply(&ctx, &params)
    }

    pub fn get_availble_token_len(ctx: Context<GetAvailableTokenLen>) -> Result<u64> {
        GetAvailableTokenLen::apply(&ctx)
    }

    pub fn get_token_index(ctx: Context<GetTokenIndex>) -> Result<u64> {
        GetTokenIndex::apply(&ctx)
    }
}
