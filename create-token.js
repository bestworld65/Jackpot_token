const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { createMint, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');

async function createJackpotToken() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('/home/hunter/.config/solana/id.json')))
  ); // Your keypair

  // Define transfer fee: 10% (1000 basis points) and max fee of 1 token
  const transferFeeConfig = {
    transferFeeConfigAuthority: wallet.publicKey, // Authority to update fees
    withdrawWithheldAuthority: wallet.publicKey, // Authority to withdraw withheld fees
    transferFeeBasisPoints: 1000, // 10% fee (1000 basis points)
    maximumFee: BigInt(1000000000), // Max fee of 1 token (in smallest unit, 10^9 lamports for 9 decimals)
  };

  // Create Token Mint with Transfer Fee extension
  const mint = await createMint(
    connection,
    wallet, // Payer
    wallet.publicKey, // Mint authority
    null, // Freeze authority (optional)
    9, // Decimals
    undefined, // Keypair for mint (auto-generated)
    {
      skipPreflight: true,
      // Include the transfer fee extension
      extensions: [transferFeeConfig],
    },
    TOKEN_2022_PROGRAM_ID
  );

  console.log('Token Mint Address:', mint.toBase58());
  fs.writeFileSync('mint-address.txt', mint.toBase58());
}

createJackpotToken().catch(console.error);