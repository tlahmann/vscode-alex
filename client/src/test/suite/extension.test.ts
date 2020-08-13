/* eslint-disable eqeqeq */
import * as assert from 'assert';
import * as path from "path";
import * as vscode from 'vscode';
//import { TextEdit } from 'vscode-languageclient';
const debug = require("debug")("vscode-alex");
const { performance } = require('perf_hooks');

// Constants
const testFolderExamplesLocation = '/../../../src/test/examples/';
const extensionId = 'tlahmann.alex-linter';

// Test documents
const testDocs: any = {
	'textfile': {
		path: 'example.txt',
		numberOfProblems: 7,
		doc: null
	}
};

// Results to check
const numberOfAlexLinterCommands = 2;

suite('VsCode AlexLinter Test Suite', async () => {
	// Check extension is available
	test("1.0 AlexLinter extension is available", async () => {
		testDocs['textfile'].doc = await openDocument('textfile');
		const availableExtensions = vscode.extensions.all.map(ext => ext.id);
		debug('Available extensions: ' + JSON.stringify(availableExtensions));

		assert(
			availableExtensions.includes(extensionId),
			"AlexLinter extension found"
		);
	}).timeout(10000);

	// Check if all commands are there
	test("1.1 Check number of AlexLinter VsCode commands", async () => {
		const allCommands = await vscode.commands.getCommands();
		debug('Commands found: ' + JSON.stringify(allCommands));
		const alexLinterCommands = allCommands.filter((command) => {
			return command.startsWith('alex-linter');
		});
		assert(
			alexLinterCommands.length === numberOfAlexLinterCommands,
			`${alexLinterCommands.length} of ${numberOfAlexLinterCommands} AlexLinter commands found`
		);
	}).timeout(5000);

	// Lint example document
	test("2.0 Lint example document", async () => {
		//testDocs['textfile'].doc = await openDocument('textfile');
		await waitUntil(() => diagnosticsChanged(testDocs['textfile'].doc.uri, []), 60000);
		const docDiagnostics = vscode.languages.getDiagnostics(testDocs['textfile'].doc.uri);

		assert(
			docDiagnostics.length >= testDocs['textfile'].numberOfProblems,
			`${docDiagnostics.length} of ${testDocs['textfile'].numberOfProblems} AlexLinter diagnostics found`
		);
	}).timeout(60000);
});

// Execute VsCode command
async function executeCommand(command: string, args: any = []): Promise<any> {
	console.log(`Execute command ${command} with args ${JSON.stringify(args)}\n`);
	return vscode.commands.executeCommand(command, ...args);
}

// Open a textDocument and show it in editor
async function openDocument(docExample: string): Promise<vscode.TextDocument> {
	const docName = testDocs[docExample].path;
	const docUri = vscode.Uri.file(
		path.join(__dirname + testFolderExamplesLocation + docName)
	);
	const document: vscode.TextDocument = await vscode.workspace.openTextDocument(docUri);
	await vscode.window.showTextDocument(document);
	await waitUntil(alexLinterExtensionIsActive, 10000) === true;
	return document;
}

function getActiveEditorText() {
	return vscode.window.activeTextEditor.document.getText();
}

async function applyTextEditsOnDoc(docUri: vscode.Uri, textEdits: vscode.TextEdit[]): Promise<any> {
	const workspaceEdit = new vscode.WorkspaceEdit();
	workspaceEdit.set(docUri, textEdits);
	const applyRes = await vscode.workspace.applyEdit(workspaceEdit);
	assert(applyRes === true, 'Edits have been applied. Err: applyRes=' + applyRes);
	console.log(`Applied ${textEdits.length} textEdits`);
	return applyRes;
}

async function disableRule(cmd: string, docUri: vscode.Uri, ruleName: string, line: number) {
	const textBefore = getActiveEditorText();
	const docDiagnostics = vscode.languages.getDiagnostics(docUri);
	const diagnostic = docDiagnostics.filter(diag => (diag.code as string).startsWith(ruleName) && (line == null || diag.range.start.line === (line - 1)))[0];
	console.log(`Diagnostic ${ruleName} identified: ${JSON.stringify(diagnostic)}`);
	assert(diagnostic != null, `Diagnostic ${ruleName} not found at line ${line}\n : ${textBefore.split('\r\n')[line]}`);
	// Request code actions
	const codeActions = await executeCommand('vscode.executeCodeActionProvider', [
		docUri,
		diagnostic.range
	]);
	//console.log('Returned codeActions: ' + JSON.stringify(codeActions));
	console.log('Returned codeActions: ' + codeActions.length);
	// Apply Quick Fix
	const cmdArgs = [docUri.toString(), diagnostic];
	await executeCommand(cmd, cmdArgs);
	await waitUntil(() => documentHasBeenUpdated(docUri, textBefore), 20000);
}

// Wait until the promise returned by testFunction is resolved or rejected
async function waitUntil(testFunction: Function, timeoutMS = 20 * 1000): Promise<any> {
	return new Promise(async (resolve, reject) => {
		let start = performance.now();
		let freq = 300;
		let result: any;
		// wait until the result is truthy, or timeout
		while (result === undefined || result === false || result === null || result.length === 0) {  // for non arrays, length is undefined, so != 0
			if ((performance.now() - start) > timeoutMS) {
				console.error('Timeout : ' + testFunction);
				reject('Timeout after ' + parseInt(performance.now(), 10) + 'ms: ' + testFunction);
				return;
			}
			await sleepPromise(freq);
			result = await testFunction();
		}
		// return result if testFunction passed
		debug('Waiting time: ' + performance.now() + ' for ' + testFunction);
		resolve(result);
	});
}

function diagnosticsChanged(docUri: vscode.Uri, prevDiags: vscode.Diagnostic[]): Promise<boolean> {
	return new Promise(async (resolve, reject) => {
		let diagsChanged = false;
		const docDiags = vscode.languages.getDiagnostics(docUri);
		if (diagsChanged === false && docDiags && docDiags.length > 0 &&
			docDiags.length !== prevDiags.length && !isWaitingDiagnostic(docDiags)
		) {
			diagsChanged = true;
			resolve(true);
		}
		const disposable = vscode.languages.onDidChangeDiagnostics((e: vscode.DiagnosticChangeEvent) => {
			if (diagsChanged === false && e.uris.filter(uriX => uriX.toString() === docUri.toString()).length > 0) {
				const docDiags = vscode.languages.getDiagnostics(docUri);
				if (docDiags && docDiags.length > 0 && !isWaitingDiagnostic(docDiags)) {
					diagsChanged = true;
				}
			}
		});
		await sleepPromise(500);
		disposable.dispose();
		resolve(diagsChanged);
	});
}

async function alexLinterExtensionIsActive(): Promise<boolean> {
	const allCommands = await vscode.commands.getCommands(true);
	return allCommands.includes('alex-linter.lint');
}

function documentHasBeenUpdated(docUri: vscode.Uri, prevDocSource: string): Promise<boolean> {
	const res = prevDocSource !== getActiveEditorText();
	if (res === true) {
		console.log(`${docUri} has been updated`);
	}
	return Promise.resolve(res);
}

// Check if the only diagnostic is the waiting one
function isWaitingDiagnostic(diags: vscode.Diagnostic[]): boolean {
	return diags && diags.length === 1 && diags[0].code === 'AlexLinterWaiting';
}

async function sleepPromise(ms: number): Promise<any> {
	await new Promise(r => setTimeout(r, ms));
}
