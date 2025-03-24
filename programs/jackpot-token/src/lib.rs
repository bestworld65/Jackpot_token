use anchor_lang::prelude::*;

declare_id!("9rAM63S9HEt59wd8iQFTJfWzjHprX4biZ9XAp1eobCwH");

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
