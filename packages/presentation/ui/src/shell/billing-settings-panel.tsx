import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Card, CardHeader, CardPanel, CardTitle } from 'coss-ui/components/card';
import { Field, FieldDescription, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import { Skeleton } from 'coss-ui/components/skeleton';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';

export interface BillingSettingsDataView {
  organizationName: string;
  canManage: boolean;
  availableNanoUsd: string;
  reservedNanoUsd: string;
  offers: Array<{
    id: string;
    name: string;
    description: string | null;
    price: { currency: string; amount: string };
    credits: { currency: string; amount: string };
  }>;
  topUpOptions: Array<{
    id: string;
    name: string;
    description: string | null;
    minimumAmountMinor: string;
    minimum: { currency: string; amount: string };
    feeBasisPoints: number;
  }>;
  orders: Array<{
    id: string;
    currency: string;
    amountMinor: string;
    refundedAmountMinor: string;
    status: 'pending' | 'paid' | 'payment_failed' | 'expired' | 'partially_refunded' | 'refunded';
    createdAt: string;
  }>;
}

export interface BillingSettingsPanelProps {
  signedIn: boolean;
  onSignIn?: () => void;
  data: BillingSettingsDataView | undefined;
  error: string | null;
  onCheckout: (offerId: string, amountMinor?: string) => Promise<void>;
  onManageSubscription: () => Promise<boolean>;
}

const RE_DOLLAR_AMOUNT = /^(\d{1,6})(?:\.(\d{0,2}))?$/;

export function BillingSettingsPanel({
  signedIn,
  onSignIn,
  data,
  error,
  onCheckout,
  onManageSubscription,
}: BillingSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.billing');
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [portalUnavailable, setPortalUnavailable] = useState(false);

  if (!signedIn) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{t('signedOut')}</p>
        {onSignIn && (
          <Button size="sm" onClick={onSignIn}>
            {t('signIn')}
          </Button>
        )}
      </div>
    );
  }
  if (error !== null && data === undefined) {
    return <p className="text-destructive text-sm">{t('loadError', { message: error })}</p>;
  }
  if (data === undefined) return <BillingSkeleton />;

  const run = (key: string, action: () => Promise<void>): void => {
    setPending(key);
    setActionError(null);
    void action()
      .catch((error_: unknown) => setActionError(error_))
      .finally(() => setPending(null));
  };

  return (
    <div className="flex flex-col gap-8">
      <p className="text-muted-foreground text-sm">
        {t('organizationHint', { organization: data.organizationName })}
      </p>
      <BalanceCard
        availableNanoUsd={data.availableNanoUsd}
        reservedNanoUsd={data.reservedNanoUsd}
      />
      {!data.canManage && (
        <p className="rounded-lg bg-warning/8 px-3 py-2 text-sm text-warning-foreground">
          {t('purchaseForbidden')}
        </p>
      )}
      <section className="space-y-3">
        <h3 className="font-medium text-sm">{t('creditPacks')}</h3>
        {data.offers.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t('offersEmpty')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.offers.map((offer) => (
              <Card key={offer.id}>
                <CardHeader className="p-4 pb-3">
                  <CardTitle className="text-sm">{offer.name}</CardTitle>
                  <p className="text-muted-foreground text-xs">
                    {offer.description ?? t('creditsIncluded', offer.credits)}
                  </p>
                </CardHeader>
                <CardPanel className="flex items-end justify-between gap-3 p-4 pt-0">
                  <div className="font-semibold tabular-nums">
                    {offer.price.currency} {offer.price.amount}
                  </div>
                  <Button
                    size="sm"
                    disabled={!data.canManage || pending !== null}
                    loading={pending === offer.id}
                    onClick={() => run(offer.id, () => onCheckout(offer.id))}
                  >
                    {t('buy')}
                  </Button>
                </CardPanel>
              </Card>
            ))}
          </div>
        )}
      </section>
      {data.topUpOptions.map((option) => (
        <VariableTopUp
          key={option.id}
          option={option}
          canManage={data.canManage}
          pending={pending !== null}
          onSubmit={(amount) => run(option.id, () => onCheckout(option.id, amount))}
        />
      ))}
      <section className="space-y-3">
        <h3 className="font-medium text-sm">{t('subscription')}</h3>
        <Card>
          <CardPanel className="flex items-center justify-between gap-4 p-4">
            <p className="text-muted-foreground text-xs">{t('subscriptionUnavailable')}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={!data.canManage || pending !== null}
              loading={pending === 'portal'}
              onClick={() =>
                run('portal', async () => {
                  setPortalUnavailable(!(await onManageSubscription()));
                })
              }
            >
              <ExternalLinkIcon />
              {t('manageSubscription')}
            </Button>
          </CardPanel>
        </Card>
        {portalUnavailable && (
          <p className="text-muted-foreground text-xs">{t('portalUnavailable')}</p>
        )}
      </section>
      <Orders orders={data.orders} />
      {actionError != null && (
        <p className="text-destructive text-xs">
          {t('actionError', { message: extractErrorMessage(actionError, false) ?? '' })}
        </p>
      )}
    </div>
  );
}

function BalanceCard({
  availableNanoUsd,
  reservedNanoUsd,
}: {
  availableNanoUsd: string;
  reservedNanoUsd: string;
}): React.ReactNode {
  const t = useTranslations('settings.billing');
  const format = useFormatter();
  return (
    <Card>
      <CardPanel className="grid grid-cols-2 gap-4 p-5">
        <div>
          <div className="text-muted-foreground text-xs">{t('available')}</div>
          <div className="mt-1 font-semibold text-2xl tabular-nums">
            {format.number(nanoUsdToRoundedUsd(availableNanoUsd), {
              style: 'currency',
              currency: 'USD',
            })}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('reserved')}</div>
          <div className="mt-1 font-semibold text-2xl tabular-nums">
            {format.number(nanoUsdToRoundedUsd(reservedNanoUsd), {
              style: 'currency',
              currency: 'USD',
            })}
          </div>
        </div>
        <p className="col-span-2 text-muted-foreground text-xs">{t('reservedHint')}</p>
      </CardPanel>
    </Card>
  );
}

function VariableTopUp({
  option,
  canManage,
  pending,
  onSubmit,
}: {
  option: BillingSettingsDataView['topUpOptions'][number];
  canManage: boolean;
  pending: boolean;
  onSubmit: (amountMinor: string) => void;
}): React.ReactNode {
  const t = useTranslations('settings.billing');
  const [amount, setAmount] = useState(option.minimum.amount);
  const amountMinor = dollarsToMinor(amount);
  const valid = amountMinor !== null && BigInt(amountMinor) >= BigInt(option.minimumAmountMinor);
  return (
    <section className="space-y-3">
      <h3 className="font-medium text-sm">{option.name}</h3>
      <Field>
        <FieldLabel>{t('topUpAmount')}</FieldLabel>
        <div className="flex gap-2">
          <Input
            className="max-w-48"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Button
            size="sm"
            disabled={!canManage || pending || !valid}
            onClick={() => {
              if (amountMinor !== null) onSubmit(amountMinor);
            }}
          >
            {t('topUp')}
          </Button>
        </div>
        <FieldDescription>
          {t('topUpHint', {
            minimum: `${option.minimum.currency} ${option.minimum.amount}`,
            fee: option.feeBasisPoints / 100,
          })}
        </FieldDescription>
      </Field>
    </section>
  );
}

function Orders({ orders }: { orders: BillingSettingsDataView['orders'] }): React.ReactNode {
  const t = useTranslations('settings.billing');
  const format = useFormatter();
  return (
    <section className="space-y-3">
      <h3 className="font-medium text-sm">{t('orders')}</h3>
      {orders.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('ordersEmpty')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <div className="text-sm tabular-nums">
                  {format.number(Number(order.amountMinor) / 100, {
                    style: 'currency',
                    currency: order.currency.toUpperCase(),
                  })}
                </div>
                <div className="text-muted-foreground text-xs">
                  {format.dateTime(new Date(order.createdAt), { dateStyle: 'medium' })}
                  {order.refundedAmountMinor !== '0' &&
                    ` · ${t('refundedAmount', {
                      amount: format.number(Number(order.refundedAmountMinor) / 100, {
                        style: 'currency',
                        currency: order.currency.toUpperCase(),
                      }),
                    })}`}
                </div>
              </div>
              <Badge variant={order.status === 'paid' ? 'success' : 'secondary'}>
                {t(`status.${order.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BillingSkeleton(): React.ReactNode {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}

function dollarsToMinor(value: string): string | null {
  const match = RE_DOLLAR_AMOUNT.exec(value.trim());
  if (!match) return null;
  const minor = BigInt(match[1]) * 100n + BigInt((match.at(2) ?? '').padEnd(2, '0') || '0');
  return minor > 0n ? String(minor) : null;
}

function nanoUsdToRoundedUsd(value: string): number {
  const cents = (BigInt(value) + 5_000_000n) / 10_000_000n;
  return Number(cents) / 100;
}
