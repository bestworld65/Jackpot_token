use anchor_lang::prelude::*;

declare_id!("H7qf9YEJMmqAqt3zYo3GfnTWHBZZj98P8vWeNuvuRKG2");

#[program]
pub mod jackpot_token {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
