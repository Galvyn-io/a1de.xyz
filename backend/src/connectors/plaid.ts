import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import { config } from '../config.js';

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[config.PLAID_ENV],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': config.PLAID_CLIENT_ID,
      'PLAID-SECRET': config.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(plaidConfig);

export async function createLinkToken(userId: string): Promise<string> {
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'A1DE Assistant',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  return response.data.link_token;
}

export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

export async function getAccounts(accessToken: string) {
  const response = await plaidClient.accountsGet({ access_token: accessToken });
  return response.data.accounts.map((a) => ({
    id: a.account_id,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    balance: a.balances.current,
    currency: a.balances.iso_currency_code,
  }));
}

export async function getTransactions(accessToken: string, startDate: string, endDate: string) {
  const response = await plaidClient.transactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
    options: { count: 100, offset: 0 },
  });
  return response.data.transactions.map((t) => ({
    id: t.transaction_id,
    name: t.name,
    amount: t.amount,
    date: t.date,
    category: t.personal_finance_category?.primary ?? t.category?.[0] ?? 'unknown',
    merchant: t.merchant_name ?? t.name,
    pending: t.pending,
  }));
}

export async function getRecurring(accessToken: string) {
  // Get accounts first (required for recurring)
  const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
  const accountIds = accountsRes.data.accounts.map((a) => a.account_id);

  const response = await plaidClient.transactionsRecurringGet({
    access_token: accessToken,
    account_ids: accountIds,
  });

  return {
    inflows: response.data.inflow_streams.map((s) => ({
      description: s.description,
      amount: s.average_amount.amount,
      frequency: s.frequency,
      category: s.personal_finance_category?.primary ?? 'unknown',
      lastDate: s.last_date,
    })),
    outflows: response.data.outflow_streams.map((s) => ({
      description: s.description,
      amount: s.average_amount.amount,
      frequency: s.frequency,
      category: s.personal_finance_category?.primary ?? 'unknown',
      lastDate: s.last_date,
    })),
  };
}
