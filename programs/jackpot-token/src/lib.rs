use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("C6Uk8RTeXcm6ntZtjcA2xWnDrYCJMKdWctJgfo3GTHWW");

#[program]
pub mod jackpot_token {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, token_mint: Pubkey, authority: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.token_mint = token_mint;
        state.authority = authority;
        state.pool_token_amount = 0;
        state.pool_sol_amount = 10_000_000_000;
        state.last_distribution = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn transfer_with_tax(ctx: Context<TransferWithTax>, amount: u64) -> Result<()> {
        let tax = amount / 10;
        let net_amount = amount - tax;
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
            from: ctx.accounts.sender.to_account_info(),
            to: ctx.accounts.authority_token_account.to_account_info(),
            authority: ctx.accounts.sender_authority.to_account_info(),
        }), tax)?;
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
            from: ctx.accounts.sender.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
            authority: ctx.accounts.sender_authority.to_account_info(),
        }), net_amount)?;
        let state = &mut ctx.accounts.state;
        state.pool_token_amount += tax;
        Ok(())
    }

    pub fn distribute(ctx: Context<Distribute>, holders: Vec<HolderInfo>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        let clock = Clock::get()?;
        let time_elapsed = clock.unix_timestamp - state.last_distribution;
        if time_elapsed < 5 { return Err(ErrorCode::TooSoon.into()); }
        let tokens_to_swap = state.pool_token_amount;
        let sol_gained = (tokens_to_swap / 1_000_000) * 1_000_000_000;
        require!(state.pool_sol_amount >= sol_gained, ErrorCode::InsufficientSol);
        state.pool_token_amount = 0;
        state.pool_sol_amount -= sol_gained;
        state.last_distribution = clock.unix_timestamp;

        let eligible_holders: Vec<&HolderInfo> = holders.iter().filter(|h| h.amount >= 200_000).collect();
        let jackpot_candidates: Vec<&HolderInfo> = holders.iter().filter(|h| h.amount >= 400_000).collect();
        if eligible_holders.is_empty() || jackpot_candidates.len() < 2 { return Err(ErrorCode::InsufficientHolders.into()); }

        let holder_accounts = &ctx.remaining_accounts;
        if holder_accounts.len() != holders.len() { return Err(ErrorCode::InsufficientHolders.into()); }

        let holder_account_map: Vec<(Pubkey, &AccountInfo)> = holders.iter().zip(holder_accounts.iter()).map(|(h, a)| (h.account, a)).collect();
        let total_holdings: u64 = eligible_holders.iter().map(|h| h.amount).sum();
        let half_sol = sol_gained / 2;

        for holder in eligible_holders.iter() {
            let proportion = (holder.amount as f64 / total_holdings as f64) * half_sol as f64;
            let lamports = proportion as u64;
            **ctx.accounts.authority.lamports.borrow_mut() -= lamports;
            **holder_account_map.iter().find(|(pk, _)| *pk == holder.account).unwrap().1.lamports.borrow_mut() += lamports;
        }

        let jackpot_per_winner = half_sol / 2;
        let winner1_idx = (clock.unix_timestamp % jackpot_candidates.len() as i64) as usize;
        let winner2_idx = ((clock.unix_timestamp + 1) % jackpot_candidates.len() as i64) as usize;
        let winner1 = jackpot_candidates[winner1_idx];
        let winner2 = jackpot_candidates[winner2_idx];

        **ctx.accounts.authority.lamports.borrow_mut() -= jackpot_per_winner;
        **holder_account_map.iter().find(|(pk, _)| *pk == winner1.account).unwrap().1.lamports.borrow_mut() += jackpot_per_winner;
        **ctx.accounts.authority.lamports.borrow_mut() -= jackpot_per_winner;
        **holder_account_map.iter().find(|(pk, _)| *pk == winner2.account).unwrap().1.lamports.borrow_mut() += jackpot_per_winner;
        Ok(())
    }

    pub fn close(ctx: Context<Close>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.pool_token_amount = 0; // Optional: Reset state before closing
        state.pool_sol_amount = 0;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 96, seeds = [b"state"], bump)]
    pub state: Account<'info, ProgramState>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferWithTax<'info> {
    #[account(mut)]
    pub state: Account<'info, ProgramState>,
    #[account(mut)]
    pub sender: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,
    pub sender_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Distribute<'info> {
    #[account(mut)]
    pub state: Account<'info, ProgramState>,
    #[account(mut, constraint = authority.key() == state.authority @ ErrorCode::InvalidAuthority)]
    /// CHECK: This is the client's authority wallet, assumed to be correct
    pub authority: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut, close = signer, has_one = authority @ ErrorCode::InvalidAuthority)]
    pub state: Account<'info, ProgramState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[account]
pub struct ProgramState {
    pub token_mint: Pubkey,
    pub authority: Pubkey,
    pub pool_token_amount: u64,
    pub pool_sol_amount: u64,
    pub last_distribution: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct HolderInfo {
    pub account: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Not enough time has passed since the last distribution")]
    TooSoon,
    #[msg("Insufficient SOL in the pool")]
    InsufficientSol,
    #[msg("Not enough eligible holders or jackpot candidates")]
    InsufficientHolders,
    #[msg("Invalid authority provided")]
    InvalidAuthority,
}