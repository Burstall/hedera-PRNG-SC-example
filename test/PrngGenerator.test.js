const {
	Client,
	AccountId,
	PrivateKey,
	ContractCreateFlow,
	ContractFunctionParameters,
	ContractExecuteTransaction,
	// eslint-disable-next-line no-unused-vars
	TransactionRecord,
} = require('@hashgraph/sdk');
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();
const { expect } = require('chai');
const { describe, it } = require('mocha');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? null;
const env = process.env.ENVIRONMENT ?? null;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let client;

describe('Deployment: ', function() {
	it('Should deploy the contract and setup conditions', async function() {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		// import ABI
		abi = json.abi;

		const contractBytecode = json.bytecode;
		const gasLimit = 500_000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		await contractDeployFcn(contractBytecode, gasLimit);

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		console.log('\n-Testing:', contractName);
	});

});

describe('Interactions: ', function() {
	it('Request a random number from the SC x 5', async function() {
		for (let i = 0; i < 5; i++) {
			const [setterIntsRx, setterResult] = await useSetterUints('getPseudorandomNumber', 1, 100, i);
			const randNum = Number(setterResult['randNum']);
			console.log('Random number:', randNum);
			expect(setterIntsRx).to.equal('SUCCESS');
			expect((randNum > 0 && randNum < 101)).to.be.true;
		}
	});

	it('Request an array of random numbers from the SC', async function() {
		const [setterIntsRx, setterResult] = await useSetterUints('getPseudorandomNumberArray', 1, 100, 1, 10);
		const randNums = setterResult['randNums'];
		console.log('Random numbers:', randNums);
		expect(setterIntsRx).to.equal('SUCCESS');
		expect(randNums.length).to.equal(10);
		let differentNumbers = false;
		let lastNum = 0;
		for (let i = 0; i < randNums.length; i++) {
			const randNum = Number(randNums[i]);
			if (lastNum == 0) lastNum = randNum;
			else if (lastNum != randNum) differentNumbers = true;
			expect((randNum > 0 && randNum < 101)).to.be.true;
		}
		expect(differentNumbers).to.be.true;
	});

});

/**
 * Helper function to deploy the contract
 * @param {string} bytecode bytecode from compiled SOL file
 * @param {number} gasLim gas limit as a number
 */
async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = await new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters(),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	contractId = contractCreateRx.contractId;
	contractAddress = contractId.toSolidityAddress();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {...number} values
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterUints(fcnName, ...values) {
	const gasLim = 300_000;
	const params = new ContractFunctionParameters();

	for (let i = 0 ; i < values.length; i++) {
		params.addUint256(values[i]);
	}
	const [setterIntsRx, setterResult] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterIntsRx.status.toString(), setterResult];
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the methos call
 * @param {boolean =true} decode whether to decode outputs
 * @returns {[TransactionReceipt, any, TransactionRecord]} the transaction receipt and any decoded results
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar, decode = true) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decode ? decodeFunctionResult(fcnName, record.contractFunctionResult.bytes) : '';
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}