use anchor_spl::{token_interface::{self, TokenAccount, TokenInterface, TransferChecked}};
use anchor_spl::token_interface::{Mint};

use crate::*;

pub fn transfer<'info>(
    payer: &Signer<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    sender_token_account: &InterfaceAccount<'info, TokenAccount>,
    rec_token_account:&InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64
) -> Result<()> {
    let decimals = mint.decimals;
 
    let cpi_accounts = TransferChecked {
        mint: mint.to_account_info(),
        from: sender_token_account.to_account_info(),
        to: rec_token_account.to_account_info(),
        authority: payer.to_account_info(),
    };
    let cpi_program = token_program.to_account_info();
    let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
    token_interface::transfer_checked(cpi_context, amount, decimals)
}

pub fn transfer_with_seeds<'info>(
    authority: &AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    sender_token_account: &InterfaceAccount<'info, TokenAccount>,
    rec_token_account:&InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let decimals = mint.decimals;
 
    let cpi_accounts = TransferChecked {
        mint: mint.to_account_info(),
        from: sender_token_account.to_account_info(),
        to: rec_token_account.to_account_info(),
        authority: authority.to_account_info(),
    };
    let cpi_program = token_program.to_account_info();
    let cpi_context = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token_interface::transfer_checked(cpi_context, amount, decimals)
}