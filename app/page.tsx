'use client';

import { useState } from 'react';
import { interestValues } from '@/lib/plan-contract';
import type { Interest, Itinerary } from '@/lib/types';

const interestLabels: Record<Interest, string> = {
  landmark: 'Landmarks',
  museum: 'Museums',
  park: 'Parks',
  architecture: 'Architecture',
  waterfront: 'Waterfront',
  food: 'Food',
  history: 'History',
};

const dollar = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

type PlannerResponse = {
  itinerary?: Itinerary;
  error?: string;
};

export default function HomePage() {
  const [date, setDate] = useState('2026-10-10');
  const [durationHours, setDurationHours] = useState(6);
  const [partySize, setPartySize] = useState(2);
  const [totalBudgetUsd, setTotalBudgetUsd] = useState(200);
  const [interests, setInterests] = useState<Interest[]>([
    'landmark',
    'architecture',
  ]);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggleInterest(interest: Interest) {
    setInterests((current) => {
      if (current.includes(interest)) {
        return current.length === 1
          ? current
          : current.filter((item) => item !== interest);
      }
      return current.length === 4 ? current : [...current, interest];
    });
  }

  async function createPlan() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          city: 'nyc',
          date,
          durationHours,
          partySize,
          totalBudgetUsd,
          interests,
        }),
      });
      const payload = (await response.json()) as PlannerResponse;
      if (!response.ok || !payload.itinerary) {
        throw new Error(payload.error ?? 'The plan could not be created.');
      }
      setItinerary(payload.itinerary);
    } catch (requestError) {
      setItinerary(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The plan could not be created.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          Wayly <span>NYC</span>
        </a>
        <a className="nav-link" href="/ops">
          Catalog operations
        </a>
      </header>

      <section className="hero">
        <div className="eyebrow">Constrained itinerary MVP</div>
        <h1>Plan a clear NYC day, within a visible budget.</h1>
        <p className="lede">
          Wayly proposes a short itinerary using only places in its published NYC
          catalog. Every stop carries a source link and a transparent planning
          allowance in USD.
        </p>
      </section>

      <section className="grid" aria-label="NYC itinerary planner">
        <div className="panel stack">
          <div>
            <h2>Your trip inputs</h2>
            <p className="caption">
              One route is generated from the constraints below. Up to four interests
              can be selected.
            </p>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="date">Date</label>
              <input id="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="duration">Available hours</label>
              <input id="duration" type="number" min="2" max="12" value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} />
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="party">Travelers</label>
              <input id="party" type="number" min="1" max="12" value={partySize} onChange={(event) => setPartySize(Number(event.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="budget">Total budget (USD)</label>
              <input id="budget" type="number" min="0" max="10000" value={totalBudgetUsd} onChange={(event) => setTotalBudgetUsd(Number(event.target.value))} />
            </div>
          </div>
          <div className="field">
            <span className="section-label">What should the route emphasize?</span>
            <div className="chips">
              {interestValues.map((interest) => (
                <button
                  className={`chip ${interests.includes(interest) ? 'active' : ''}`}
                  key={interest}
                  onClick={() => toggleInterest(interest)}
                  type="button"
                >
                  {interestLabels[interest]}
                </button>
              ))}
            </div>
          </div>
          <button className="primary" disabled={loading} onClick={createPlan} type="button">
            {loading ? 'Building your plan…' : 'Build my NYC plan'}
          </button>
          <div className="trust">
            <strong>What this MVP does:</strong> it uses a curated 20-place catalog and
            shows group planning allowances. It does not confirm tickets, opening
            hours, availability, directions, or accessibility services.
          </div>
        </div>

        <div className="panel">
          {itinerary ? (
            <div>
              <div className="plan-header">
                <div>
                  <div className="eyebrow">Generated route</div>
                  <h2>{itinerary.title}</h2>
                  <p className="caption">For {partySize} traveler{partySize === 1 ? '' : 's'} on {date}</p>
                </div>
                <div className="budget">{dollar.format(itinerary.totalAllowanceUsd)}</div>
              </div>
              <div className="stops">
                {itinerary.stops.map((stop, index) => (
                  <article className="stop" key={stop.id}>
                    <div className="stop-number">{index + 1}</div>
                    <div>
                      <h3>{stop.name}</h3>
                      <p>{stop.neighborhood} · {stop.suggestedMinutes} minutes suggested</p>
                      <p>{stop.accessNote}</p>
                    </div>
                    <div className="stop-cost">{dollar.format(stop.groupAllowanceUsd)}</div>
                  </article>
                ))}
              </div>
              <div className="trust">
                {itinerary.notes.map((note) => <p key={note}>{note}</p>)}
                <p><strong>Remaining planning budget:</strong> {dollar.format(itinerary.remainingBudgetUsd)}</p>
              </div>
              <div className="sources">
                <h2>Source links for this route</h2>
                <ul>
                  {itinerary.sources.map((source) => (
                    <li key={source.name}>
                      <a href={source.sourceUrl} rel="noreferrer" target="_blank">
                        {source.name} — {source.sourceName}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="empty">
              <div>
                <h2>Your route will appear here.</h2>
                <p className="caption">Start with a date, available time, party size, USD budget, and route interests.</p>
                {error ? <p className="notice">{error}</p> : null}
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="footer">
        Catalog version: nyc-poi-v1 · Last source review: October 5, 2026 · <a href="/ops">Inspect the published catalog</a>
      </footer>
    </main>
  );
}
