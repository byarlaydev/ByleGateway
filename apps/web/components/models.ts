export type App = {
  id: string;
  name: string;
  key_prefix: string;
  active: boolean;
  created_at: string;
  webhook_url?: string | null;
  payment_count?: string;
};
export type Payment = {
  id: string;
  app_id: string;
  app_name: string;
  order_id: string;
  amount: string;
  status: string;
  currency: string;
  description: string;
  created_at: string;
  qr?: string;
  checkout_url?: string | null;
  last_error?: string | null;
  checkout_expires_at?: string;
};
