use anchor_lang::prelude::*;
use anchor_lang::prelude::Result as AnchorResult;
use std::result::Result;

use crate::errors::WagmiError;
use crate::state::token::AvailableToken;
use crate::state::{Asset, SwapParams};



pub fn encode_available_token(token: &AvailableToken) -> AnchorResult<Vec<u8>> {

    let mut data = Vec::new();
    
    data.extend_from_slice(&[0u8; 31]);
    data.push(0x40);
    
    // for token in tokens {
        let mut bool_bytes = [0u8; 32];
        bool_bytes[31] = token.on_pause as u8;
        data.extend_from_slice(&bool_bytes);
        
        let mut token_bytes = [0u8; 32];
        token_bytes[12..].copy_from_slice(&token.token_address.to_bytes()[..20]);
        data.extend_from_slice(&token_bytes);
        
        let mut synth_bytes = [0u8; 32];
        synth_bytes.copy_from_slice(&token.synthetic_token_address);
        data.extend_from_slice(&synth_bytes);
        
        let mut delta_bytes = [0u8; 32];
        if token.decimals_delta < 0 {
            delta_bytes = [0xff; 32]; 
        }
        delta_bytes[31] = token.decimals_delta as u8;
        data.extend_from_slice(&delta_bytes);
        
        let mut amount_bytes = [0u8; 32];
        let amt_be_bytes = token.min_bridge_amt.to_be_bytes();
        amount_bytes[32-amt_be_bytes.len()..].copy_from_slice(&amt_be_bytes);
        data.extend_from_slice(&amount_bytes);
    // }
    
    Ok(data)
}


pub fn encode_swap_params(params: &SwapParams) -> AnchorResult<Vec<u8>> {
    let mut data = Vec::new();


    data.extend_from_slice(params.from.as_ref());          
    data.extend_from_slice(&params.to);                    
    data.extend_from_slice(&params.synthetic_token_out);   
    data.extend_from_slice(&params.gas_limit.to_be_bytes()); 
    data.extend_from_slice(&params.dst_eid.to_be_bytes());   
    data.extend_from_slice(&params.value.to_be_bytes());     

    
    data.extend_from_slice(&params.assets.token_address.to_bytes());
    data.extend_from_slice(&params.assets.token_amount.to_be_bytes());

    data.extend_from_slice(&(params.commands.len() as u32).to_be_bytes());
    data.extend_from_slice(&params.commands);

    data.extend_from_slice(&(params.inputs.len() as u32).to_be_bytes());
    for input in &params.inputs {
        data.extend_from_slice(&(input.len() as u32).to_be_bytes());
        data.extend_from_slice(input);
    }

    data.extend_from_slice(&params.minimum_amount_out.to_be_bytes()); 

    Ok(data)
}

pub fn encode_deposit(sender: Pubkey, recepient: [u8; 32], asset: &Asset) -> AnchorResult<Vec<u8>> {
    let mut data = Vec::new();


    data.extend_from_slice(&[0u8; 31]);
    data.push(0x40);

    
    let mut sender_bytes = [0u8; 32];
    sender_bytes[..].copy_from_slice(&sender.to_bytes());
    data.extend_from_slice(&sender_bytes);
    data.extend_from_slice(&recepient);




        let mut token_bytes = [0u8; 32];
        token_bytes[12..32].copy_from_slice(&asset.token_address.to_bytes()[..20]);
        data.extend_from_slice(&token_bytes);

        let mut amount_bytes = [0u8; 32];
        let amt_be_bytes = asset.token_amount.to_be_bytes();
        amount_bytes[16..32].copy_from_slice(&amt_be_bytes);
        data.extend_from_slice(&amount_bytes);

    Ok(data)
}


    pub fn decode_proccess_message(data: &[u8]) -> Result<([u8;32], Pubkey, Asset), WagmiError> {
        const MIN_DATA_LENGTH: usize = 32 + 32 + 32 + 32;
        if data.len() < MIN_DATA_LENGTH {
            return Err(WagmiError::DecodingError);
        }
    
        // Decode first [u8;32] field
        let to_field: [u8; 32] = data[0..32]
            .try_into()
            .map_err(|_| WagmiError::DecodingError)?;
    
        // Decode Pubkey (32 bytes)
        let from_pubkey = Pubkey::try_from(&data[32..64])
            .map_err(|_| WagmiError::DecodingError)?;
    
        // Decode Asset
        let token_address = Pubkey::try_from(&data[64..96])
            .map_err(|_| WagmiError::DecodingError)?;
        
        let token_amount_bytes: [u8; 16] = data[112..128]
            .try_into()
            .map_err(|_| WagmiError::DecodingError)?;
        let token_amount = u128::from_be_bytes(token_amount_bytes);
    
        let asset = Asset {
            token_address,
            token_amount,
        };
    
        Ok((to_field, from_pubkey, asset))

}


pub fn decode_process_message_revert_swap(data: &[u8]) -> Result<([u8;32], Pubkey, Asset, [u8;32], String), WagmiError> {
    // Minimum length: 32 (to_field) + 32 (from_pubkey) + 32 (token_address) + 16 (token_amount) + 32 (extra field) + 4 (string length)
    const MIN_DATA_LENGTH: usize = 32 + 32 + 32 + 32 + 32 + 4;
    if data.len() < MIN_DATA_LENGTH {
        return Err(WagmiError::DecodingError);
    }

    // Decode first [u8;32] field (0-32)
    let to_field: [u8; 32] = data[0..32]
        .try_into()
        .map_err(|_| WagmiError::DecodingError)?;

    // Decode Pubkey (32-64)
    let from_pubkey = Pubkey::try_from(&data[32..64])
        .map_err(|_| WagmiError::DecodingError)?;

    // Decode Asset (64-112)
    let token_address = Pubkey::try_from(&data[64..96])
        .map_err(|_| WagmiError::DecodingError)?;
    
    let token_amount_bytes: [u8; 16] = data[112..128]
        .try_into()
        .map_err(|_| WagmiError::DecodingError)?;
    let token_amount = u128::from_be_bytes(token_amount_bytes);

    let asset = Asset {
        token_address,
        token_amount,
    };

    // Decode additional [u8;32] field (112-144)
    let extra_field: [u8; 32] = data[128..160]
        .try_into()
        .map_err(|_| WagmiError::DecodingError)?;

    // Decode string length (144-148)
    let len_bytes: [u8; 4] = data[188..192]
        .try_into()
        .map_err(|_| WagmiError::DecodingError)?;
    let string_len = u32::from_be_bytes(len_bytes) as usize;

    // Check if string data is available (148+)
    let string_start = 148;
    let string_end = string_start + string_len;
    if data.len() < string_end {
        return Err(WagmiError::DecodingError);
    }

    // Decode UTF-8 string
    let string_data = &data[string_start..string_end];
    let message = String::from_utf8(string_data.to_vec())
        .map_err(|_| WagmiError::DecodingError)?;

    Ok((to_field, from_pubkey, asset, extra_field, message))
}