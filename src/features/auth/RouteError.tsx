import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';

/** Shown instead of React Router's default error screen if a page throws while rendering. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main role="alert" style={{ padding: '3rem 1.5rem', maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p style={{ marginBottom: '1.5rem' }}>
        {notFound ? 'That page does not exist.' : 'The page failed to load. Reloading usually fixes it.'}
      </p>
      <p style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
        <Link to="/">Go to ChatSpace</Link>
      </p>
    </main>
  );
}
