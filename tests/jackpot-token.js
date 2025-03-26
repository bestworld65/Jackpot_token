import * as anchor from "@coral-xyz/anchor";
import anchorPkg from '@project-serum/anchor';
const { BN } = anchorPkg;
// import { JackpotToken } from "../target/types/jackpot_token.js";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair, Keypair as SolanaKeypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccountInstruction, mintTo, getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import fs from 'fs';

describe("jackpot-token", () => {
  const walletKeypair = SolanaKeypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/home/hunter/.config/solana/id.json", "utf8")))
  );
  console.log("Wallet public key:", walletKeypair.publicKey.toBase58());
  
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    new anchor.Wallet(walletKeypair),
    anchor.AnchorProvider.defaultOptions()
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.JackpotToken;
  if (!program) {
    throw new Error("Program not found in workspace. Run 'anchor build' and check Anchor.toml.");
  }
  const wallet = provider.wallet;

  console.log("Program ID:", program.programId.toBase58());

  it("Setup token and accounts", async () => {
    const balance = await provider.connection.getBalance(wallet.publicKey);
    if (balance < LAMPORTS_PER_SOL) {
      await provider.connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const mintKeypair = Keypair.generate();
    const tokenMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      mintKeypair,
      undefined,
      TOKEN_PROGRAM_ID
    );

    const senderOwner = Keypair.generate();
    const recipientOwner = Keypair.generate();
    const authorityOwner = wallet.payer;

    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: senderOwner.publicKey,
        lamports: LAMPORTS_PER_SOL / 10,
      }),
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: recipientOwner.publicKey,
        lamports: LAMPORTS_PER_SOL / 10,
      })
    );
    await provider.sendAndConfirm(fundTx, [wallet.payer]);

    const senderAccount = await getAssociatedTokenAddress(tokenMint, senderOwner.publicKey);
    const recipientAccount = await getAssociatedTokenAddress(tokenMint, recipientOwner.publicKey);
    const authorityTokenAccount = await getAssociatedTokenAddress(tokenMint, authorityOwner.publicKey);

    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        senderAccount,
        senderOwner.publicKey,
        tokenMint,
        TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientAccount,
        recipientOwner.publicKey,
        tokenMint,
        TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        authorityTokenAccount,
        authorityOwner.publicKey,
        tokenMint,
        TOKEN_PROGRAM_ID
      )
    );

    await provider.sendAndConfirm(tx, [wallet.payer]);

    await mintTo(
      provider.connection,
      wallet.payer,
      tokenMint,
      senderAccount,
      wallet.payer,
      1_000_000_000,
      [wallet.payer]
    );

    console.log("Token mint:", tokenMint.toBase58());
    console.log("Sender account:", senderAccount.toBase58());
    console.log("Recipient account:", recipientAccount.toBase58());
    console.log("Authority token account:", authorityTokenAccount.toBase58());

    global.tokenMint = tokenMint;
    global.senderAccount = senderAccount;
    global.recipientAccount = recipientAccount;
    global.authorityTokenAccount = authorityTokenAccount;
    global.senderOwner = senderOwner;
    global.recipientOwner = recipientOwner;
  });

  it("Initialize", async () => {
    const [statePda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );
    console.log("State PDA:", statePda.toBase58());
    console.log("Bump:", bump);

    const tx = await program.methods
      .initialize(global.tokenMint, wallet.publicKey)
      .accounts({
        state: statePda,
        signer: wallet.publicKey,
        system_program: SystemProgram.programId, // Fix typo from "systemProgram"
      })
      .transaction();

    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
    console.log("Transaction before signing:", tx);
    console.log("Expected signer:", wallet.publicKey.toBase58());

    try {
      const signature = await provider.sendAndConfirm(tx, [wallet.payer]);
      console.log("Initialize tx signature:", signature);
    } catch (err) {
      console.error("Initialize failed:", err);
      throw err;
    }

    const state = await program.account.programState.fetch(statePda);
    console.log("State initialized:", state);
    global.statePda = statePda;
  });

  it("Transfer with tax", async () => {
    await program.methods
      .transferWithTax(new BN(1_000_000))
      .accounts({
        state: global.statePda,
        sender: global.senderAccount,
        recipient: global.recipientAccount,
        authorityTokenAccount: global.authorityTokenAccount,
        senderAuthority: global.senderOwner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([global.senderOwner])
      .rpc();

    const senderBal = await getAccount(provider.connection, global.senderAccount);
    const authorityBal = await getAccount(provider.connection, global.authorityTokenAccount);
    console.log("Sender balance:", senderBal.amount.toString());
    console.log("Authority balance:", authorityBal.amount.toString());
  });

  it("Distribute", async () => {
    const holder1 = Keypair.generate();
    const holder2 = Keypair.generate();
    const holder3 = Keypair.generate();

    for (const holder of [holder1, holder2, holder3]) {
      try {
        const tx = new anchor.web3.Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: holder.publicKey,
            lamports: LAMPORTS_PER_SOL / 10,
          })
        );
        await provider.sendAndConfirm(tx, [wallet.payer]);
      } catch (err) {
        console.warn(`Failed to fund ${holder.publicKey.toBase58()}:`, err);
      }
    }

    const holders = [
      { account: wallet.publicKey, amount: new BN(500_000) },
      { account: holder1.publicKey, amount: new BN(300_000) },
      { account: holder2.publicKey, amount: new BN(400_000) },
      { account: holder3.publicKey, amount: new BN(600_000) },
    ];

    await new Promise((resolve) => setTimeout(resolve, 5000));

    await program.methods
      .distribute(holders)
      .accounts({
        state: global.statePda,
        authority: wallet.publicKey,
      })
      .remainingAccounts(
        holders.map((h) => ({
          pubkey: h.account,
          isWritable: true,
          isSigner: false,
        }))
      )
      .rpc();

    const state = await program.account.programState.fetch(global.statePda);
    console.log("Post-distribution state:", state);
  });
});