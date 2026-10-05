import { nycPlaces } from '@/lib/nyc-places';

export default function OperationsPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Wayly <span>NYC</span></a>
        <a className="nav-link" href="/">Trip planner</a>
      </header>
      <section className="hero">
        <div className="eyebrow">Catalog operations</div>
        <h1>Published NYC places.</h1>
        <p className="lede">
          This MVP uses only the 20 records listed below. A record has a source link,
          a review date, coordinates, category tags, an access note, and a USD planning allowance.
        </p>
      </section>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr><th>Place</th><th>Tags</th><th>Allowance</th><th>Source</th><th>Reviewed</th></tr>
          </thead>
          <tbody>
            {nycPlaces.map((place) => (
              <tr key={place.id}>
                <td><strong>{place.name}</strong><br /><span className="caption">{place.neighborhood}</span></td>
                <td>{place.interests.join(', ')}</td>
                <td>${place.planningAllowanceUsd} per traveler</td>
                <td><a href={place.sourceUrl} rel="noreferrer" target="_blank">{place.sourceName}</a></td>
                <td>{place.reviewedOn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer className="footer">Planning allowances are not ticket quotes. Recheck each source before travel.</footer>
    </main>
  );
}
