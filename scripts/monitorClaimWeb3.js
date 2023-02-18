require('dotenv').config();
const fs = require('fs');
const Web3 = require('web3');
const { ContractId, AccountId } = require('@hashgraph/sdk');

const options = {
	providerOptions: {
		keepalive: true,
		credentials: 'omit',
		headers: {
			'Access-Control-Allow-Origin': '*',
		},
	},
};

let web3, abi;

const contractName = process.env.CONTRACT_NAME ?? null;
const eventName = process.env.EVENT_NAME ?? null;

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {

	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}

	if (env.toUpperCase() == 'TEST') {
		web3 = new Web3(new Web3.providers.HttpProvider('https://testnet.hashio.io/api', options));
		console.log('interacting in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		web3 = new Web3(new Web3.providers.HttpProvider('https://mainnet.hashio.io/api', options));
		console.log('interacting in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Contract:', contractId.toString(), 'with name:', contractName, 'and address:', contractId.toSolidityAddress());
	console.log('\n-Using Event:', eventName);
	console.log('\n-Using Provider:', web3.currentProvider.host);
	console.log('\n-Using connected:', web3.currentProvider.connected);
	console.log('\n-Using Block Number:', await web3.eth.getBlockNumber());

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	abi = json.abi;
	console.log('\n -Loading ABI...\n');

	const contract = new web3.eth.Contract(abi, contractId.toSolidityAddress());

	let blockNumber = await web3.eth.getBlockNumber() - 900;
	let lastPrintedBlockNumber = blockNumber;
	const hashQueue = [];
	while (true) {
		try {
			const events = await contract.getPastEvents(eventName, { fromBlock: blockNumber, toBlock: 'latest' });
			if (events.length > 0) {
				for (const event of events) {
					if (!hashQueue.includes(event.transactionHash)) {
						// limit the array to 500 hashes to prevent memory issues
						if (hashQueue.length == 500) {
							hashQueue.shift();
						}
						hashQueue.push(event.transactionHash);
						const outputStr = event.transactionHash + ' : '
							+ AccountId.fromSolidityAddress(event.returnValues.caller).toString()
							+ ' -> ' + Number(event.returnValues.randomNumber) + ' from seed('
							+ event.returnValues.seedBytes + ') @ ' + new Date(event.returnValues.timestamp * 1000).toLocaleString();
						console.log(outputStr);
					}
				}
			}
			blockNumber = await web3.eth.getBlockNumber();
			await sleep(2000);
		}
		catch (error) {
			if (!(error.message.includes('Invalid JSON RPC response') || error.message.includes('CONNECTION ERROR'))) {
				console.log(error.name, '<->', error.message);
			}
			await sleep(30000);
		}
		if (blockNumber > (lastPrintedBlockNumber + 500)) {
			lastPrintedBlockNumber = blockNumber;
			console.log('blockNumber:', blockNumber, 'at', new Date().toLocaleString());
		}
	}

};

/*
 * basic sleep function
 * @param {number} ms milliseconds to sleep
 * @returns {Promise}
 */
// eslint-disable-next-line no-unused-vars
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
// eslint-disable-next-line no-unused-vars
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}

// eslint-disable-next-line no-unused-vars
function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});