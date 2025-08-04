import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IDL, WagmiOmnichainApp } from "../target/types/wagmi_omnichain_app";
import { 
  PublicKey, 
  SystemProgram, 
  Transaction, 
  Connection, 
  sendAndConfirmTransaction,
  ParsedAccountData,
  ComputeBudgetProgram
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ENDPOINT_SEED, EndpointProgram, SEND_LIBRARY_CONFIG_SEED, SendHelper } from "@layerzerolabs/lz-solana-sdk-v2";
import {
    getMetadataAccountDataSerializer,
    MPL_TOKEN_METADATA_PROGRAM_ID,
  } from '@metaplex-foundation/mpl-token-metadata';


  
// Constants
const ENDPOINT_PROGRAM_ID = new PublicKey("76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6");

// Seeds
const GATEWAY_VAULT_SEED = Buffer.from("GatewayVault");
const LZ_RECEIVE_TYPES_SEED = Buffer.from("LzReceiveTypes");
const OAPP_SEED = Buffer.from("OApp");
const EVENT_SEED = Buffer.from("__event_authority");
const PEER_SEED = Buffer.from("Peer");

export type TokenMetadata = {
    tokenAccountAddress: PublicKey;
    metadataAccount: PublicKey;
    symbol: string;
    balance: number;
    decimals: number;
    onPause: boolean;
    tokenAddress: PublicKey;
    syntheticTokenAddress: number[]; 
    decimalsDelta: number;
    minBridgeAmt: anchor.BN;
  };

export type AvailableToken = {
    onPause: boolean;
    tokenAddress: PublicKey;
    syntheticTokenAddress: number[];
    decimalsDelta: number;
    minBridgeAmt: anchor.BN;
  };
// Types
export interface Asset {
  tokenAddress: PublicKey;
  tokenAmount: anchor.BN;
}

export type TokenConfig = {
    onPause: boolean;
    tokenAddress: PublicKey;
    syntheticTokenDecimals: number;
    syntheticTokenAddress: number [];
    minBridgeAmt: anchor.BN;
  };



export interface TokenSetupConfig {
  tokenAddress: PublicKey;
  tokenDecimals: number;
  tokenSymbol: string;
  tokenName: string;
}

type SwapParams = {
    from: PublicKey;              
    to: number[];                
    syntheticTokenOut: number[]; 
    gasLimit: anchor.BN;            
    dstEid: number;               
    value: anchor.BN;                 
    assets: Asset;                 
    commands: Buffer<ArrayBufferLike>;        
    inputs: Buffer<ArrayBufferLike>[];        
    minimumAmountOut: anchor.BN;   
  };


export interface InitGatewayVaultParams {
  admin: PublicKey;
}

export interface QuoteSendParams {
  dstEid: number;
  options: Buffer;
}

export interface SetPeerConfigParams {
  peer: number;
  config: Buffer;
}

export interface LzReceiveParams {
  origin: {
    sender: Buffer;
    nonce: anchor.BN;
  };
  guid: Buffer;
  message: Buffer;
  executor: Buffer;
  extraData: Buffer;
}

export class WagmiOmnichainClient {
  private program: Program<WagmiOmnichainApp>;
  private connection: Connection;
  private wallet: anchor.Wallet;
  private endpoint: EndpointProgram.Endpoint;
  private ENDPOINT_ID: number;
  private sendHelper: SendHelper;
  private programId: PublicKey;

  private receiver: string;
  constructor(
    connection: Connection,
    wallet: anchor.Wallet,
    receiver: string,
    programId: PublicKey,
    endpointId = 40245
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.programId = programId;

    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      { commitment: "confirmed" }
    );
    anchor.setProvider(provider);

    this.program = new anchor.Program(IDL, programId, provider);
    this.endpoint = new EndpointProgram.Endpoint(ENDPOINT_PROGRAM_ID);
    this.receiver = receiver;
    this.sendHelper = new SendHelper(ENDPOINT_PROGRAM_ID);
    this.ENDPOINT_ID = endpointId;
  }

  // PDA derivation methods
  private getGatewayVaultPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [GATEWAY_VAULT_SEED],
      this.program.programId
    );
  }

  private getLzReceiveTypesPDA(gatewayVault: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [LZ_RECEIVE_TYPES_SEED, gatewayVault.toBuffer()],
      this.program.programId
    );
  }

  private getOAppRegistryPDA(gatewayVault: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [OAPP_SEED, gatewayVault.toBuffer()],
      ENDPOINT_PROGRAM_ID
    );
  }

  private getEventAuthorityPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [EVENT_SEED],
      ENDPOINT_PROGRAM_ID
    );
  }

  private getPeerConfigPDA(gatewayVault: PublicKey, peer: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [PEER_SEED, gatewayVault.toBuffer(), new anchor.BN(peer).toArrayLike(Buffer, 'le', 4)],
      this.program.programId
    );
  }

  // Initialize Gateway Vault
  async initGatewayVault(params: InitGatewayVaultParams): Promise<string> {
    const [gatewayVaultKey, gatewayVaultBump] = this.getGatewayVaultPDA();
    const [lzReceiveTypesKey] = this.getLzReceiveTypesPDA(gatewayVaultKey);
    const [oappRegistryKey] = this.getOAppRegistryPDA(gatewayVaultKey);
    const [eventAuthorityAccount] = this.getEventAuthorityPDA();

    const accounts = {
      payer: this.wallet.publicKey,
      gatewayVault: gatewayVaultKey,
      lzReceiveTypesAccounts: lzReceiveTypesKey,
      systemProgram: SystemProgram.programId,
      eventAuthorityAccount: eventAuthorityAccount,
      enpointProgram: ENDPOINT_PROGRAM_ID,
      oappRegistry: oappRegistryKey
    };

    const idBuf = Buffer.alloc(4);
    idBuf.writeUInt32BE(this.ENDPOINT_ID);

    const dstAddress = this.evmAddressToBytes(this.receiver);

    const initializeStoreIx = await this.program.methods
      .initGatewayVault({
        ...params,
          receiverAddress: dstAddress,
          dstEid: this.ENDPOINT_ID,
          endpoint: ENDPOINT_PROGRAM_ID
      })
      .accounts(accounts).instruction();

      const [sendLibraryConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from(SEND_LIBRARY_CONFIG_SEED), gatewayVaultKey.toBuffer(), idBuf],
        ENDPOINT_PROGRAM_ID
      );
    

      const setLibraryAccount =  {
        delegate: this.wallet.publicKey,
        oappRegistry: oappRegistryKey,
        sendLibraryConfig: sendLibraryConfig,
        systemProgram: SystemProgram.programId
      }

      const createInitSendLibraryInstruction = EndpointProgram.instructions.createInitSendLibraryInstruction(
        setLibraryAccount, {params: { sender: gatewayVaultKey, eid: this.ENDPOINT_ID}}, ENDPOINT_PROGRAM_ID
    )


    const rawBytes = Buffer.from(this.receiver.slice(2), "hex");
    const padded = Buffer.alloc(32);
    rawBytes.copy(padded, 12)
    const receiver: number[] = Array.from(padded);

    const initNonve = this.endpoint.initOAppNonce(this.wallet.publicKey,this.ENDPOINT_ID, gatewayVaultKey, Buffer.from(receiver))
    


    const [peer, ] = 
    PublicKey.findProgramAddressSync(
        [PEER_SEED, gatewayVaultKey.toBuffer(), idBuf],
        this.programId
    )


      const setPeerConfigIx = await this.program.methods
      .setPeerConfig(
        {
            remoteEid: this.ENDPOINT_ID,
            config: {peerAddress: [receiver]}
        }
      )
        .accounts({
            systemProgram: SystemProgram.programId,
            gatewayVault: gatewayVaultKey,
            admin: this.wallet.publicKey,
            peer
        }).instruction();

        const tx = new Transaction().add(initializeStoreIx, createInitSendLibraryInstruction, initNonve, setPeerConfigIx)
        tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash
        tx.feePayer = this.wallet.publicKey
        const signature = await sendAndConfirmTransaction(this.connection, tx, [this.wallet.payer])
        console.log('Transaction sent with signature:', signature)
        return signature
  }

  // Quote operations
  async quoteSend(token: AvailableToken, options: Buffer): Promise<any> {
    const [gatewayVaultKey, gatewayVaultBump] = this.getGatewayVaultPDA();

  const quoteAccounts = await this.sendHelper.getQuoteAccounts(
    this.connection,
    this.wallet.publicKey,
    gatewayVaultKey,
    this.ENDPOINT_ID,
    this.receiver,
  )
  
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32BE(this.ENDPOINT_ID);


  const [peer, ] = 
  PublicKey.findProgramAddressSync(
      [PEER_SEED, gatewayVaultKey.toBuffer(), idBuf],
      this.programId
  )

  const [endpointPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(ENDPOINT_SEED)],
      ENDPOINT_PROGRAM_ID
  )
  
  const rawBytes = Buffer.from(this.receiver.slice(2), "hex");
  const padded = Buffer.alloc(32);
  rawBytes.copy(padded, 12)
  const receiver: number[] = Array.from(padded);

const quote = 
  await this.program.methods
  .quoteSend({dstEid: this.ENDPOINT_ID, 
    message: token, 
    options: options,
     payInLzToken: false, 
     receiver
    })
     .accounts({
      store: gatewayVaultKey,
      peer,
      endpoint: endpointPDA
     })
     .remainingAccounts(quoteAccounts)
     .view()

     return quote;
  }

  async quoteDeposit(asset: Asset, options: Buffer): Promise<any> {
     const [gatewayVaultKey, gatewayVaultBump] = this.getGatewayVaultPDA();

  const quoteAccounts = await this.sendHelper.getQuoteAccounts(
    this.connection,
    this.wallet.publicKey,
    gatewayVaultKey,
    this.ENDPOINT_ID,
    this.receiver,
  )
  
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32BE(this.ENDPOINT_ID);


  const [peer, ] = 
  PublicKey.findProgramAddressSync(
      [PEER_SEED, gatewayVaultKey.toBuffer(), idBuf],
      this.programId
  )

  const [endpointPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(ENDPOINT_SEED)],
      ENDPOINT_PROGRAM_ID
  )
  
  const rawBytes = Buffer.from(this.receiver.slice(2), "hex");
  const padded = Buffer.alloc(32);
  rawBytes.copy(padded, 12)
  const receiver: number[] = Array.from(padded);

const quote = 
  await this.program.methods
  .quoteDeposit({dstEid: this.ENDPOINT_ID, 
    message: asset, 
    options: options,
     payInLzToken: false, 
     receiver
    })
     .accounts({
      store: gatewayVaultKey,
      peer,
      endpoint: endpointPDA
     })
     .remainingAccounts(quoteAccounts)
     .view()
     
     return quote;
  }

  async quoteSwap(asset: SwapParams, options: Buffer): Promise<any> {
    const [gatewayVaultKey, gatewayVaultBump] = this.getGatewayVaultPDA();

    const quoteAccounts = await this.sendHelper.getQuoteAccounts(
      this.connection,
      this.wallet.publicKey,
      gatewayVaultKey,
      this.ENDPOINT_ID,
      this.receiver,
    )
    
    const idBuf = Buffer.alloc(4);
    idBuf.writeUInt32BE(this.ENDPOINT_ID);
  
  
    const [peer, ] = 
    PublicKey.findProgramAddressSync(
        [PEER_SEED, gatewayVaultKey.toBuffer(), idBuf],
        this.programId
    )
  
    const [endpointPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(ENDPOINT_SEED)],
        ENDPOINT_PROGRAM_ID
    )
    
    const rawBytes = Buffer.from(this.receiver.slice(2), "hex");
    const padded = Buffer.alloc(32);
    rawBytes.copy(padded, 12)
    const receiver: number[] = Array.from(padded);
  

  const quote = 
    await this.program.methods
    .quoteSwap({
      dstEid: this.ENDPOINT_ID, 
      message: asset, 
      options: options,
       payInLzToken: false, 
       receiver
      })
       .accounts({
        store: gatewayVaultKey,
        peer,
        endpoint: endpointPDA
       })
       .remainingAccounts(quoteAccounts)
       .view()
       
       return quote;
  }

  async pauseToken(onPause: boolean): Promise<string> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();

    const accounts = {
      gatewayVault: gatewayVaultKey,
    };

    const tx = await this.program.methods
      .pauseToken(onPause)
      .accounts(accounts)
      .rpc();

    return tx;
  }

  async linkTokenToHub(
    params: TokenConfig,
    options: Buffer
  ): Promise<string> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();

    const remainingAccounts =
    await this.sendHelper.getSendAccounts(
      this.connection,
        this.wallet.publicKey,
        gatewayVaultKey,
          this.ENDPOINT_ID,
          this.receiver
    )


    const [tokenIndexSaver,] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  new PublicKey(params.tokenAddress).toBuffer()],
        this.programId
    )
    let currentIndex = await this.program.account.gatewayVault.fetch(gatewayVaultKey,'confirmed');

    const indexBuf = Buffer.alloc(8);

    let index = BigInt(currentIndex.tokenCount.toNumber())
    indexBuf.writeBigInt64BE(index, 0);

    const [tokenProgramAccount, ] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  indexBuf],
        this.programId
    )

    const accounts = {
      payer: this.wallet.publicKey,
      gatewayVault: gatewayVaultKey,
      systemProgram: SystemProgram.programId,
      newTokenProgramAccount: tokenProgramAccount,
      newTokenIndexSaver: tokenIndexSaver,
      mintAccount: params.tokenAddress
    };

  

    let availableToken = {
      onPause: params.onPause,
      tokenAddress: params.tokenAddress,
      syntheticTokenAddress: this.evmAddressToBytes(this.receiver),
      decimalsDelta: params.syntheticTokenDecimals,
      minBridgeAmt: params.minBridgeAmt,
      tokenAmount: new anchor.BN(0)
    }

    let quote = await this.quoteSend(availableToken, options);

    const ix = await this.program.methods
    .linkTokenToHub(
      params,
      quote.nativeFee,
      options
    )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction()

      let transaction = new Transaction().add( 
        ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000
      })
    )
    transaction.add(ix);
    transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash
    transaction.feePayer = this.wallet.publicKey
    
      const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.wallet.payer])
      
    return signature;
  }

  // Deposit operation
  async deposit(
    asset: Asset,
    recipient: string,
    sender: PublicKey,
    options: Buffer
  ): Promise<string> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();
    const remainingAccounts =
    await this.sendHelper.getSendAccounts(
      this.connection,
        this.wallet.publicKey,
        gatewayVaultKey,
          this.ENDPOINT_ID,
          this.receiver
    )
    
    const [tokenIndexSaver,] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  new PublicKey(asset.tokenAddress).toBuffer()],
        this.programId
    )
    let currentIndex = await this.program.account.tokenIndex.fetch(tokenIndexSaver);
    const indexBuf = Buffer.alloc(8);

    let index = BigInt(currentIndex.index.toNumber())
    indexBuf.writeBigInt64BE(index, 0);

    const [tokenProgramAccount, ] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  indexBuf],
        this.programId
    )

    const senderTokenAccount = getAssociatedTokenAddressSync(
      asset.tokenAddress,
      sender
 )

    const programTokenAccount = getAssociatedTokenAddressSync(
      asset.tokenAddress,
      gatewayVaultKey,
      true
    )
    const accounts = {
      payer: this.wallet.publicKey,
      gatewayVault: gatewayVaultKey,
      tokenProgramAccount,
      mintAccount: asset.tokenAddress,
      senderTokenAccount,
      programTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };




    const rawBytesRecepient = Buffer.from(recipient.slice(2), "hex");
    const paddedRecepient = Buffer.alloc(33);
    rawBytesRecepient.copy(paddedRecepient, 12)
    const recepient: number[] = Array.from(paddedRecepient);


    let quote = await this.quoteDeposit(asset, options);

    let token_index = await this.program.account.tokenIndex.fetch(tokenIndexSaver)

    const ix = await this.program.methods
    .deposit(
      token_index.index,
      asset,
      recepient,
      quote.nativeFee,
      options
    )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction()


      let transaction = new Transaction().add( 
        ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000
      })
    )
    transaction.add(ix);
    transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash
    transaction.feePayer = this.wallet.publicKey
    
    const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.wallet.payer])

    return signature;

  }

  // Swap operation
  async swap(
    swapParams: SwapParams,
    asset: Asset,
    sender: PublicKey,
    options: Buffer
  ): Promise<string> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();
    const remainingAccounts =
    await this.sendHelper.getSendAccounts(
      this.connection,
        this.wallet.publicKey,
        gatewayVaultKey,
          this.ENDPOINT_ID,
          this.receiver
    )


    const [tokenIndexSaver,] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  new PublicKey(asset.tokenAddress).toBuffer()],
        this.programId
    )
    let currentIndex = await this.program.account.tokenIndex.fetch(tokenIndexSaver);
    const indexBuf = Buffer.alloc(8);

    let index = BigInt(currentIndex.index.toNumber())
    indexBuf.writeBigInt64BE(index, 0);

    const [tokenProgramAccount, ] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  indexBuf],
        this.programId
    )

    const senderTokenAccount = getAssociatedTokenAddressSync(
      asset.tokenAddress,
      sender
 )

    const programTokenAccount = getAssociatedTokenAddressSync(
      asset.tokenAddress,
      gatewayVaultKey,
      true
    )

    const [swapStorage, ] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  sender.toBuffer()],
        this.programId
    )
    
    const accounts = {
      payer: this.wallet.publicKey,
      gatewayVault: gatewayVaultKey,
      tokenProgramAccount,
      mintAccount: asset.tokenAddress,
      senderTokenAccount,
      programTokenAccount,
      swapStorage,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };


    let quote = await this.quoteSwap(swapParams, options);

    await this.store_swap_data(swapParams, sender);

    let token_index = await this.program.account.tokenIndex.fetch(tokenIndexSaver)
    
    const swap_ix = await this.program.methods
    .swap(
      token_index.index,
      asset,
      quote.nativeFee,
      options
    )
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .instruction();



      let transaction = new Transaction().add( 
        ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000
      })
    )
    transaction.add(swap_ix);
    transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash
    transaction.feePayer = this.wallet.publicKey
    
    const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.wallet.payer])

    return signature;

  }
  async store_swap_data(
    swapParams: SwapParams,
    sender: PublicKey
  ): Promise<string> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();

    const [swapStorage, ] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  sender.toBuffer()],
        this.programId
    )
    
    const tx = await this.program.methods
    .storeSwapData(
      swapParams
    )
      .accounts({
        gatewayVault: gatewayVaultKey,
        payer: sender,
        swapStorage,
        systemProgram: SystemProgram.programId

      })
      .remainingAccounts([])
      .rpc();

      return tx;
  }




  // Query operations
  async getAvailableTokenLen(): Promise<anchor.BN> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();

    const accounts = {
      store: gatewayVaultKey,
    };

    return await this.program.methods
      .getAvailbleTokenLen()
      .accounts(accounts)
      .view();

  }

  async getAllAvailableTokens(): Promise<TokenMetadata[]> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();

  

      let tokenData = await this.program.account.availableToken.all();

      let mappedTokenData = tokenData.map((token) => { 
        let [metadataAccount,] = PublicKey.findProgramAddressSync(
            [
              Buffer.from('metadata'),
              new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
              token.account.tokenAddress.toBuffer(),
            ],
            new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
            
          )
        return {
            ...token.account,
            tokenAccountAddress: getAssociatedTokenAddressSync(
                gatewayVaultKey,
                this.wallet.publicKey,
                true
              ),
              metadataAccount,
              symbol: "",
              balance: 0,
              decimals: 0
            }
      });


      let metadataAccounts = await this.connection.getMultipleAccountsInfo(mappedTokenData.map((token) => token.metadataAccount))
      const dataSerializer = getMetadataAccountDataSerializer();

        metadataAccounts.forEach((info, idx) => {
          if(info !== null) {
        const decodedData = dataSerializer.deserialize(info.data);
        let index = mappedTokenData.findIndex(token => token.tokenAddress.toBase58() === decodedData[0].mint)
       mappedTokenData[index].symbol = decodedData[0].symbol
          }
      });

      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(gatewayVaultKey, {programId: TOKEN_PROGRAM_ID})
      tokenAccounts.value.forEach((token) => {
        const info = (token.account.data as ParsedAccountData).parsed.info;

        let index = mappedTokenData.findIndex(token => token.tokenAddress.toBase58() === info.mint)
        mappedTokenData[index].balance = info.tokenAmount.amount
        mappedTokenData[index].decimals = info.tokenAmount.decimals
      })

      return mappedTokenData;

  }


  async getAllAvailableTokenByAddres(tokenAddress: PublicKey): Promise<TokenMetadata> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();

  
    const [tokenIndexSaver,] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  tokenAddress.toBuffer()],
        this.programId
    )
    let token_index = await this.program.account.tokenIndex.fetch(tokenIndexSaver,'confirmed');

    const indexBuf = Buffer.alloc(8);

    let index = BigInt(token_index.index.toNumber())
    indexBuf.writeBigInt64BE(index, 0);

    const [tokenProgramAccount, ] = 
    PublicKey.findProgramAddressSync(
      [gatewayVaultKey.toBuffer(),  indexBuf],
        this.programId
    )

      let tokenData = await this.program.account.availableToken.fetch(tokenProgramAccount);

        let [metadataAccount,] = PublicKey.findProgramAddressSync(
            [
              Buffer.from('metadata'),
              new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
              tokenData.tokenAddress.toBuffer(),
            ],
            new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
            
          )
        let tokenWithMeta = {
            ...tokenData,
            tokenAccountAddress: getAssociatedTokenAddressSync(
                gatewayVaultKey,
                this.wallet.publicKey,
                true
              ),
              metadataAccount,
              symbol: "",
              balance: 0,
              decimals: 0
            }


          let metadataAccountInfo = await this.connection.getAccountInfo(metadataAccount)
      const dataSerializer = getMetadataAccountDataSerializer();

        if(metadataAccountInfo !== null) {
        const decodedData = dataSerializer.deserialize(metadataAccountInfo.data);
        tokenWithMeta.symbol = decodedData[0].symbol
        }

      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(gatewayVaultKey, {programId: TOKEN_PROGRAM_ID})
      tokenAccounts.value.forEach((token) => {
        const info = (token.account.data as ParsedAccountData).parsed.info;
        if (info.mint === tokenWithMeta.tokenAddress.toBase58()) {
        tokenWithMeta.balance = info.tokenAmount.amount
        tokenWithMeta.decimals = info.tokenAmount.decimals
        }
      })

      return tokenWithMeta;

  }

  async getTokenIndex(tokenAddress: PublicKey): Promise<anchor.BN> {
    const [gatewayVaultKey] = this.getGatewayVaultPDA();

    const [tokenIndexData] = PublicKey.findProgramAddressSync(
      [
        gatewayVaultKey.toBuffer(), tokenAddress.toBuffer()
      ],
      this.programId
    )

    const accounts = {
      store: gatewayVaultKey,
      tokenIndexData,
      mintAccount: tokenAddress
    };

    return await this.program.methods
      .getTokenIndex()
      .accounts(accounts)
      .view();
  }

  evmAddressToBytes(address: string): number[] {
   
    const rawBytes = Buffer.from(address.slice(2), "hex");
    const padded = Buffer.alloc(32);
    rawBytes.copy(padded, 12)
    const receiver: number[] = Array.from(padded);

    return receiver;
  }
}
