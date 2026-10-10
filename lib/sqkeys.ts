// SQ Keys: contract between the UI and the wallet logic (CDC.md, section 7.7).
// Pages call only these functions.
//
// MOCK: at milestone 0 every function returns consistent fake data after 500 ms.
// Nothing here touches a blockchain, a passkey or a server. Each mock is replaced
// milestone by milestone without changing the signatures.
//
// `k` is the number of guardians required in addition to the recovery phrase;
// the on-chain threshold is `k + 1`.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardianType = "phrase" | "physical" | "device" | "person" | "address" | "swissquote";

export type Guardian = {
  address: string;
  label: string;
  type: GuardianType;
  addedAt: string;
};

export type Account = {
  address: string;
  deployed: boolean;
  owner: { type: "phone"; label: string; synced?: boolean };
  guardians: Guardian[];
  k: number;
  onchainThreshold: number;
  delaySeconds: number;
  recoveryInProgress: boolean;
};

export type CheckId = "simulation" | "sanctions" | "address" | "amount" | "application" | "unlimited";
export type CheckStatus = "ok" | "warning" | "blocked";
export type TransferCheck = { id: CheckId; status: CheckStatus; message: string };
export type TransferChecks = { checks: TransferCheck[]; highValue: boolean };

export type RecoveryStatus = "collecting" | "refused" | "pending" | "cancelled" | "finalized";

export type RecoveryRequest = {
  account: string;
  requesterDevice: string;
  knownDevice: boolean;
  createdAt: string;
  status: RecoveryStatus;
};

export type Recovery = {
  status: RecoveryStatus;
  approvals: number;
  onchainThreshold: number;
  endsAt?: string;
};

export type AlertType = "recovery_started" | "recovery_refused" | "recovery_cancelled" | "guardian_changed";
export type Alert = { id: string; type: AlertType; createdAt: string; message: string };

// ---------------------------------------------------------------------------
// MOCK data (fake addresses and hashes, no real key or phrase)
// ---------------------------------------------------------------------------

const MOCK_DELAY_MS = 500;

function mock<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

const MOCK_ACCOUNT_ADDRESS = "0x5afe000000000000000000000000000000000001";
const MOCK_TX_HASH = "0x" + "ab".repeat(32);
const MOCK_SIGNATURE = "0x" + "cd".repeat(65);
const MOCK_BALANCE_USDC = "25.00";
const MOCK_HIGH_VALUE_USDC = 5;
const MOCK_SANCTIONED_ADDRESS = "0x000000000000000000000000000000000000dead";
const MOCK_KNOWN_RECIPIENT = "0x1111111111111111111111111111111111111111";
const MOCK_K = 2;
const MOCK_DELAY_SECONDS = 180;
const MOCK_REQUEST_ID = "req_mock_001";
const MOCK_CREATED_AT = "2026-10-10T12:30:00.000Z";

// Placeholder words, not a valid BIP-39 phrase.
const MOCK_WORDS = [
  "apple", "bridge", "candle", "dolphin", "engine", "forest",
  "garden", "harbor", "island", "jungle", "kettle", "lemon",
];
const MOCK_NEW_WORDS = [
  "marble", "needle", "orange", "pencil", "quartz", "river",
  "silver", "tunnel", "umbrella", "violin", "window", "yellow",
];

const MOCK_GUARDIANS: Guardian[] = [
  { address: "0x9a00000000000000000000000000000000000001", label: "Recovery phrase", type: "phrase", addedAt: MOCK_CREATED_AT },
  { address: "0x9a00000000000000000000000000000000000002", label: "Téo", type: "person", addedAt: MOCK_CREATED_AT },
  { address: "0x9a00000000000000000000000000000000000003", label: "Physical key", type: "physical", addedAt: MOCK_CREATED_AT },
  { address: "0x9a00000000000000000000000000000000000004", label: "Hardware wallet", type: "address", addedAt: MOCK_CREATED_AT },
];

// ---------------------------------------------------------------------------
// Identity and account
// ---------------------------------------------------------------------------

// MOCK: will go through sq-mock.
export function loginSwissquote(clientId: string, password: string): Promise<{ clientId: string; name: string }> {
  void password;
  return mock({ clientId, name: "Léa" });
}

// MOCK
export function createWallet(): Promise<{ address: string }> {
  return mock({ address: MOCK_ACCOUNT_ADDRESS });
}

// MOCK
export function createRecoveryPhrase(): Promise<{ words: string[] }> {
  return mock({ words: [...MOCK_WORDS] });
}

// MOCK: `index` is the 1-based word number shown to the user (no. 3, no. 7, no. 11).
export function confirmRecoveryPhrase(answers: { index: number; word: string }[]): Promise<boolean> {
  const ok =
    answers.length > 0 &&
    answers.every(({ index, word }) => MOCK_WORDS[index - 1] === word.trim().toLowerCase());
  return mock(ok);
}

// MOCK
export function getAccount(): Promise<Account> {
  return mock({
    address: MOCK_ACCOUNT_ADDRESS,
    deployed: true,
    owner: { type: "phone", label: "Phone key", synced: true },
    guardians: MOCK_GUARDIANS.map((g) => ({ ...g })),
    k: MOCK_K,
    onchainThreshold: MOCK_K + 1,
    delaySeconds: MOCK_DELAY_SECONDS,
    recoveryInProgress: false,
  });
}

// MOCK
export function getBalance(): Promise<{ usdc: string }> {
  return mock({ usdc: MOCK_BALANCE_USDC });
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

// MOCK: demo rules only (one sanctioned address, one known recipient, 5 USDC limit).
export function checkTransfer(to: string, amount: string): Promise<TransferChecks> {
  const recipient = to.trim().toLowerCase();
  const sanctioned = recipient === MOCK_SANCTIONED_ADDRESS;
  const known = recipient === MOCK_KNOWN_RECIPIENT;
  const highValue = Number(amount) > MOCK_HIGH_VALUE_USDC;

  const checks: TransferCheck[] = [
    {
      id: "simulation",
      status: "ok",
      message: `You are sending ${amount} USDC. Nothing else leaves your account.`,
    },
    {
      id: "sanctions",
      status: sanctioned ? "blocked" : "ok",
      message: sanctioned ? "This address is on a sanctions list." : "Address not listed.",
    },
    {
      id: "address",
      status: known ? "ok" : "warning",
      message: known
        ? "Address already used."
        : "First time you send to this address. Check it character by character.",
    },
    {
      id: "amount",
      status: highValue ? "warning" : "ok",
      message: highValue
        ? "High amount: an extra confirmation will be required."
        : `Below your limit of ${MOCK_HIGH_VALUE_USDC} USDC.`,
    },
  ];
  return mock({ checks, highValue });
}

// MOCK
export function sendUsdc(to: string, amount: string): Promise<{ txHash: string }> {
  void to;
  void amount;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function approveApp(spender: string, amount: string | "unlimited"): Promise<{ txHash: string }> {
  void spender;
  void amount;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK: will be verified by sq-mock.
export function signOwnershipProof(): Promise<{ message: string; signature: string; verified: boolean }> {
  return mock({
    message: `I confirm I own the wallet ${MOCK_ACCOUNT_ADDRESS}. Client SQ-000001. 2026-10-10.`,
    signature: MOCK_SIGNATURE,
    verified: true,
  });
}

// MOCK: will go through sq-mock.
export function transferFromSwissquote(amount: string): Promise<{ txHash: string }> {
  void amount;
  return mock({ txHash: MOCK_TX_HASH });
}

// ---------------------------------------------------------------------------
// Guardians (signed by the phone key, refused while a recovery is in progress)
// ---------------------------------------------------------------------------

// MOCK
export function createGuardianInvite(
  label: string,
  type: "physical" | "device" | "person",
): Promise<{ inviteId: string; inviteUrl: string }> {
  void label;
  void type;
  return mock({ inviteId: "inv_mock_001", inviteUrl: "/guardian/invite/inv_mock_001" });
}

// MOCK: runs on the guardian's device.
export function acceptGuardianInvite(inviteId: string): Promise<{ guardianAddress: string }> {
  void inviteId;
  return mock({ guardianAddress: MOCK_GUARDIANS[1].address });
}

// MOCK
export function addAddressGuardian(label: string, address: string, proofSignature: string): Promise<void> {
  void label;
  void address;
  void proofSignature;
  return mock(undefined);
}

// MOCK
export function setupRecovery(guardianAddresses: string[], k: number): Promise<{ txHash: string }> {
  void guardianAddresses;
  void k;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function removeGuardian(guardianAddress: string, newK: number): Promise<{ txHash: string }> {
  void guardianAddress;
  void newK;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function changeK(newK: number): Promise<{ txHash: string }> {
  void newK;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function replaceRecoveryPhrase(): Promise<{ words: string[]; txHash: string }> {
  return mock({ words: [...MOCK_NEW_WORDS], txHash: MOCK_TX_HASH });
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

// MOCK: will create the new device's passkey; a client ID will be resolved by the
// server through sq-mock /resolve-account, without storing it.
export function startRecovery(accountOrClientId: string): Promise<{ requestId: string; approveUrl: string }> {
  void accountOrClientId;
  return mock({ requestId: MOCK_REQUEST_ID, approveUrl: `/recovery/approve/${MOCK_REQUEST_ID}` });
}

// MOCK
export function approveRecoveryWithPhrase(
  requestId: string,
  words: string[],
): Promise<{ approvals: number; onchainThreshold: number }> {
  void requestId;
  void words;
  return mock({ approvals: 1, onchainThreshold: MOCK_K + 1 });
}

// MOCK: for the guardian's screen.
export function getRecoveryRequest(requestId: string): Promise<RecoveryRequest> {
  void requestId;
  return mock({
    account: MOCK_ACCOUNT_ADDRESS,
    requesterDevice: "iPhone, Safari",
    knownDevice: false,
    createdAt: MOCK_CREATED_AT,
    status: "collecting",
  });
}

// MOCK: runs on the guardian's device.
export function approveRecovery(requestId: string): Promise<{ approvals: number; onchainThreshold: number }> {
  void requestId;
  return mock({ approvals: 2, onchainThreshold: MOCK_K + 1 });
}

// MOCK: "Refuse and alert" is an app-level alert, never sent by email.
export function refuseRecovery(requestId: string, reason?: string): Promise<void> {
  void requestId;
  void reason;
  return mock(undefined);
}

// MOCK: no recovery in progress, consistent with getAccount().
export function getRecovery(account: string): Promise<null | Recovery> {
  void account;
  return mock(null);
}

// MOCK: will be signed by the phone key.
export function cancelRecovery(): Promise<{ txHash: string }> {
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function finalizeRecovery(account: string): Promise<{ txHash: string }> {
  void account;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function getAlerts(): Promise<Alert[]> {
  return mock([
    {
      id: "alert_mock_001",
      type: "guardian_changed",
      createdAt: MOCK_CREATED_AT,
      message: "A guardian was added to your account.",
    },
  ]);
}
