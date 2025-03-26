import { MarketV2, DEVNET_PROGRAM_ID, TxVersion, buildSimpleTransaction, Liquidity } from '@raydium-io/raydium-sdk';
import * as anchor from '@project-serum/anchor';
import anchorPkg from '@project-serum/anchor';
const { BN } = anchorPkg;
import pkg from '@solana/web3.js';
const { PublicKey, VersionedTransaction, LAMPORTS_PER_SOL, TOKEN_PROGRAM_ID } = pkg;
import { getAssociatedTokenAddress, createSyncNativeInstruction } from '@solana/spl-token';

const connection = new anchor.web3.Connection('https://api.devnet.solana.com', 'confirmed');

const secretKey = Uint8Array.from([218,231,114,109,146,240,202,10,230,48,176,36,38,37,156,103,148,224,228,251,47,200,80,46,224,220,216,152,224,248,28,225,161,21,50,161,80,172,82,54,219,29,220,40,210,44,140,235,148,97,130,95,243,100,58,2,192,153,87,162,48,214,14,73]);
const wallet = anchor.web3.Keypair.fromSecretKey(secretKey);
const makeTxVersion = TxVersion.V0;

async function sendTx(connection, wallet, txs, options) {
    const tx = txs[0];
    if (!(tx instanceof VersionedTransaction)) {
      throw new Error("Expected a VersionedTransaction");
    }
    tx.sign([wallet]);
    return await connection.sendTransaction(tx, { skipPreflight: options.skipPreflight });
  }
  
  async function buildAndSendTx(innerSimpleV0Transaction, options) {
    const willSendTx = await buildSimpleTransaction({
      connection,
      makeTxVersion,
      payer: wallet.publicKey,
      innerTransactions: innerSimpleV0Transaction,
    });
    return await sendTx(connection, wallet, willSendTx, options);
  }
  
  async function createMarket() {
    const baseToken = { 
      mint: new PublicKey('FwkfrfrrhebcJuCQUXCEEXgRgaCmhtF2VqsMWsggbWji'), 
      decimals: 6 
    };
    const quoteToken = { 
      mint: new PublicKey('So11111111111111111111111111111111111111112'), 
      decimals: 9 
    };
  
    const marketInstructions = await MarketV2.makeCreateMarketInstructionSimple({
      connection,
      wallet: wallet.publicKey,
      baseInfo: baseToken,
      quoteInfo: quoteToken,
      lotSize: 1,          // Minimum order size (1 unit of base token)
      tickSize: 0.01,      // Price tick (0.01 SOL per base token)
      dexProgramId: DEVNET_PROGRAM_ID.OPENBOOK_MARKET,
      makeTxVersion,
    });
  
    const marketId = marketInstructions.address.marketId;
    const fixedInnerTransactions = marketInstructions.innerTransactions.map((tx) => ({
      ...tx,
      instructions: tx.instructions.map((instr) => ({
        ...instr,
        programId: new PublicKey(instr.programId),
        keys: instr.keys.map((key) => ({
          ...key,
          pubkey: new PublicKey(key.pubkey),
        })),
      })),
    }));
  
    const txids = await buildAndSendTx(fixedInnerTransactions, { skipPreflight: true });
    
    console.log('Market Created');
    console.log('Create Market Transactions:', txids);
    console.log('Market Address:', marketId.toBase58());
    
    return marketId;
  }
  
  async function createPool(marketId) {
    const baseToken = new PublicKey('FwkfrfrrhebcJuCQUXCEEXgRgaCmhtF2VqsMWsggbWji');
    const quoteToken = new PublicKey('So11111111111111111111111111111111111111112');
  
    const solBalance = await connection.getBalance(wallet.publicKey);
    const baseTokenAccount = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: baseToken });
    const baseBalance = baseTokenAccount.value[0] ? (await connection.getTokenAccountBalance(baseTokenAccount.value[0].pubkey)).value.uiAmount : 0;
    const quoteTokenATA = await getAssociatedTokenAddress(quoteToken, wallet.publicKey);
    let quoteTokenAccountInfo = await connection.getTokenAccountBalance(quoteTokenATA, 'confirmed').catch(() => null);
    let quoteBalance = quoteTokenAccountInfo ? quoteTokenAccountInfo.value.uiAmount : 0;
  
    console.log("Creating pool with:");
    console.log("Market ID:", marketId.toBase58());
    console.log("Base Mint:", baseToken.toBase58());
    console.log("Quote Mint:", quoteToken.toBase58());
    console.log("Payer:", wallet.publicKey.toBase58());
    console.log("SOL Balance:", solBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("Base Token Balance:", baseBalance, "tokens");
    console.log("Quote Token ATA:", quoteTokenATA.toBase58());
    console.log("Quote Token Balance:", quoteBalance, "wSOL");
  
    const baseAmount = new BN(1000000000); // 1000 tokens (6 decimals)
    const quoteAmount = new BN(10000000000); // 10 wSOL (9 decimals)
  
    const ataSolBalance = await connection.getBalance(quoteTokenATA);
    if (ataSolBalance > LAMPORTS_PER_SOL && quoteBalance < 10) {
      console.log("Syncing wSOL ATA with existing SOL balance...");
      const tx = new anchor.web3.Transaction().add(
        createSyncNativeInstruction(quoteTokenATA)
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;
      const txSig = await connection.sendTransaction(tx, [wallet], { skipPreflight: false });
      await connection.confirmTransaction(txSig, 'confirmed');
      quoteTokenAccountInfo = await connection.getTokenAccountBalance(quoteTokenATA, 'confirmed');
      quoteBalance = quoteTokenAccountInfo.value.uiAmount;
      console.log("Updated Quote Token Balance after sync:", quoteBalance, "wSOL");
    }
  
    if (quoteBalance < 10) {
      console.log("Wrapping 10 SOL to wSOL...");
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: quoteTokenATA,
          lamports: 10 * LAMPORTS_PER_SOL,
        }),
        createSyncNativeInstruction(quoteTokenATA)
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;
      const txSig = await connection.sendTransaction(tx, [wallet], { skipPreflight: false });
      await connection.confirmTransaction(txSig, 'confirmed');
      quoteTokenAccountInfo = await connection.getTokenAccountBalance(quoteTokenATA, 'confirmed');
      quoteBalance = quoteTokenAccountInfo.value.uiAmount;
      console.log("Updated Quote Token Balance after wrap:", quoteBalance, "wSOL");
    }
  
    console.log("Pool creation parameters:");
    console.log("Base Amount:", baseAmount.toString());
    console.log("Quote Amount:", quoteAmount.toString());
    console.log("Market ID:", marketId.toBase58());
    console.log("Program ID:", DEVNET_PROGRAM_ID.AmmV4.toBase58());
  
    try {
      const poolKeys = await Liquidity.makeCreatePoolV4InstructionV2Simple({
        connection,
        programId: DEVNET_PROGRAM_ID.AmmV4,
        marketId: marketId,
        baseMint: baseToken,
        quoteMint: quoteToken,
        baseAmount: baseAmount,
        quoteAmount: quoteAmount,
        payer: wallet.publicKey,
        makeTxVersion,
        config: {
          associatedOnly: true,
          checkCreateATAOwner: true,
        },
      });
  
      const fixedInnerTransactions = poolKeys.innerTransactions.map((tx) => ({
        ...tx,
        instructions: tx.instructions.map((instr) => ({
          ...instr,
          programId: new PublicKey(instr.programId),
          keys: instr.keys.map((key) => ({
            ...key,
            pubkey: new PublicKey(key.pubkey),
          })),
        })),
      }));
  
      const txids = await buildAndSendTx(fixedInnerTransactions, { skipPreflight: true });
      
      console.log('Pool Created');
      console.log('Create Pool Transactions:', txids);
      console.log('Pool Address:', poolKeys.id.toBase58());
      
      return poolKeys.id;
    } catch (error) {
      console.error("Pool creation failed:", error);
      throw error;
    }
  }
  
  async function main() {
    console.log("Creating a new market...");
    const newMarketId = await createMarket();
    console.log("Waiting for market creation to settle...");
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5-second delay
    console.log("Creating pool with new market ID...");
    const poolId = await createPool(newMarketId);
  }
  
  main().catch((err) => console.error("Error:", err));