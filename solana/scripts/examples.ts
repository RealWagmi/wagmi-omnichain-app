import * as anchor from "@coral-xyz/anchor";
import { IDL } from "../target/types/wagmi_omnichain_app";
import { PublicKey} from "@solana/web3.js";
import { WagmiOmnichainClient } from "./WagmiOmnichainClient";
import { Options } from '@layerzerolabs/lz-v2-utilities'

const DEVNET_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("4Qe94DXb6LYRQtpCKnM9BTr9DcXbXsN7H5XcocED3ny9"); 
const RECEIVER_ADDRESS = "0x3EC43A1c67F50C7131f35AA7387e8958Dc67453d"



const GAS_LIMIT = 200_000; 
const MSG_VALUE = 2_500_000; 

const ENDPOINT_ID = 40245


async function main() {
  const connection = new anchor.web3.Connection(DEVNET_URL, "confirmed");
  const wallet = anchor.Wallet.local(); 
  
  const provider = new anchor.AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  let wagmiApp = new WagmiOmnichainClient(
    connection,
    wallet,
    RECEIVER_ADDRESS, /*dapp address on dst chain*/
    PROGRAM_ID
  )
///
  const mockdata = {    
    onPause: false,
    tokenAddress: new PublicKey("HPzaQGMdSkAbP9wKemc23bif5KsXqn1Ng9BifJHM8QUj"),
    syntheticTokenDecimals: 18,
    syntheticTokenAddress: wagmiApp.evmAddressToBytes(RECEIVER_ADDRESS),
    minBridgeAmt: new anchor.BN("1000000000000"),
  }

  const options = Options.newOptions().addExecutorLzReceiveOption(GAS_LIMIT, MSG_VALUE);
  // / init app, layer zero initialization inlcuded
  let initTxSignature = await wagmiApp.initGatewayVault({admin: wallet.publicKey})

  // / link token tx
  let linkTokenTxSignature = await wagmiApp.linkTokenToHub(mockdata, Buffer.from(options.toBytes()))


  let asset = {
    tokenAddress:  new PublicKey("HPzaQGMdSkAbP9wKemc23bif5KsXqn1Ng9BifJHM8QUj"),
    tokenAmount: new anchor.BN("1000000000000")
  }
  /// deposit tx
  let depositTxSignature = await wagmiApp.deposit(asset, RECEIVER_ADDRESS, wallet.publicKey, Buffer.from(options.toBytes()))


  
let swapParams = {
    from: wallet.publicKey,
    to: wagmiApp.evmAddressToBytes(RECEIVER_ADDRESS),
    syntheticTokenOut: wagmiApp.evmAddressToBytes(RECEIVER_ADDRESS),
    gasLimit: new anchor.BN(GAS_LIMIT),
    dstEid: ENDPOINT_ID,
    value: new anchor.BN(GAS_LIMIT),
    assets: {
      tokenAddress: new PublicKey("HPzaQGMdSkAbP9wKemc23bif5KsXqn1Ng9BifJHM8QUj"),
      tokenAmount: new anchor.BN("1000000000000"),
    },
    commands: Buffer.from(''),
    inputs: [Buffer.from('')],
    minimumAmountOut: new anchor.BN(1000),
  };

  
let swapTxSignature = await wagmiApp.swap(
    swapParams,
    {
      tokenAddress: new PublicKey("HPzaQGMdSkAbP9wKemc23bif5KsXqn1Ng9BifJHM8QUj"),
      tokenAmount: new anchor.BN("1000000000000"),
    },
    wallet.publicKey,
    Buffer.from(options.toBytes())
    )

let availableTokenByAddress = await wagmiApp.getAllAvailableTokenByAddres(new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"));

let availableTokens = await wagmiApp.getAllAvailableTokens();

}

main().catch(console.error);