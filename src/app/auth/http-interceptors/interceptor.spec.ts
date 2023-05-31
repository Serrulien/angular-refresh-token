import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { BruteForceInterceptor } from './brute-force.interceptor';
import { AuthService } from '../auth.service';
import { of, throwError } from 'rxjs';
import { catchError, delay } from 'rxjs/operators';
import { CaughtInterceptor } from './caught.interceptor';
import { RetryWhenInterceptor } from './retry-when.interceptor';

[
  BruteForceInterceptor,
  CaughtInterceptor,
  RetryWhenInterceptor
].forEach(interceptor => {
  describe(interceptor.name + ' testing', () => {
    let authService: AuthService;
    let httpClient: HttpClient;
    let httpTestingController: HttpTestingController;
    const testUrl = '/api';
    const testData = { name: 'Test Data' };
    const wait = ms => new Promise(res => setTimeout(res, ms));

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [HttpClientTestingModule],
        providers: [
          {
            provide: HTTP_INTERCEPTORS,
            useClass: interceptor,
            multi: true,
          },
          AuthService,
        ],
      });

      authService = TestBed.inject(AuthService);
      httpClient = TestBed.inject(HttpClient);
      httpTestingController = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      // After every test, assert that there are no more pending requests.
      httpTestingController.verify();
    });

    it('should send Authorization header', () => {
      authService.authenticate();
      httpClient.get(testUrl).subscribe();

      const request = httpTestingController.expectOne(testUrl);
      expect(request.request.headers.has('Authorization')).toEqual(true);
    });

    it('should refresh token and use the new token fir request resend', fakeAsync(() => {
      authService.authenticate();
      httpClient.get(testUrl).subscribe((data) => expect(data).toEqual(testData));

      tick();

      const firstRequest = httpTestingController.expectOne(testUrl);
      const firstToken = firstRequest.request.headers.get('Authorization');
      firstRequest.flush(
        { error: 'invalid_grant' },
        {
          status: 401,
          statusText: 'Unauthorized',
        }
      );

      tick();

      // token sucessfully refreshed, resend the request with the new token
      const secondRequest = httpTestingController.expectOne(testUrl);
      secondRequest.flush(testData);
      const refreshedToken = secondRequest.request.headers.get('Authorization');
      expect(refreshedToken).not.toEqual(firstToken);
    }));

    it('should refresh token only once for multiple requests', fakeAsync(() => {
      authService.authenticate();
      let counter = 0;
      const refreshSpy = spyOn(authService, 'refreshToken').and.returnValue(
        of({
          get accessToken(): string {
            return 'newToken' + ++counter;
          },
        }).pipe(
          delay(0),
        )
      );

      httpClient.get(testUrl).subscribe((data) => expect(data).toEqual(testData));
      httpClient.get(testUrl).subscribe((data) => expect(data).toEqual(testData));

      let requests = httpTestingController.match(testUrl);
      expect(requests.length).toEqual(2);
      requests.forEach((request) =>
        request.flush(
          { error: 'invalid_grant' },
          {
            status: 401,
            statusText: 'Unauthorized',
          }
        )
      );

      tick();
      // continue requests after refreshing token
      httpTestingController.match(testUrl).forEach(request => request.flush(testData));

      tick(200);

      httpClient.get(testUrl).subscribe((data) => expect(data).toEqual(testData));
      httpClient.get(testUrl).subscribe((data) => expect(data).toEqual(testData));
      httpClient.get(testUrl).subscribe((data) => {
        expect(data).toEqual(testData);
        expect(refreshSpy.calls.count()).toBe(2, 'refreshToken called once');
      });

      requests = httpTestingController.match(testUrl);
      // expect(requests.length).toEqual(2);
      requests.forEach((request) =>
        request.flush(
          { error: 'invalid_grant' },
          {
            status: 401,
            statusText: 'Unauthorized',
          }
        )
      );

      tick();
      // continue requests after refreshing token
      httpTestingController.match(testUrl).forEach(request => request.flush(testData));
    }));

    it('should log out user if refreshToken failed', () => {
      authService.authenticate();

      spyOn(authService, 'refreshToken').and.returnValue(throwError('Bad word!'));
      const logoutSpy = spyOn(authService, 'logout');

      httpClient
        .get(testUrl)
        .pipe(catchError((err) => of('')))
        .subscribe();
      httpClient
        .get(testUrl)
        .pipe(catchError((err) => of('')))
        .subscribe();

      let requests = httpTestingController.match(testUrl);
      expect(requests.length).toEqual(2);
      requests.forEach((request) =>
        request.flush(
          { error: 'invalid_grant' },
          {
            status: 401,
            statusText: 'Unauthorized',
          }
        )
      );

      requests = httpTestingController.match(testUrl);
      expect(requests.length).toEqual(0);

      expect(logoutSpy).toHaveBeenCalled();
    });

    it('should log out if user gets an error after first refreshing', fakeAsync(() => {
      authService.authenticate();
      httpClient
        .get(testUrl)
        .pipe(catchError(() => of('error')))
        .subscribe((data) => expect(data).toEqual('error'));
      const logoutSpy = spyOn(authService, 'logout');
      httpTestingController.expectOne(testUrl).flush(
        { error: 'invalid_grant' },
        {
          status: 401,
          statusText: 'Unauthorized',
        }
      );

      tick();
      httpTestingController.expectOne(testUrl).flush(
        { error: 'invalid_grant' },
        {
          status: 401,
          statusText: 'Unauthorized',
        }
      );
      expect(logoutSpy).toHaveBeenCalled();
    }));

    if (interceptor !== BruteForceInterceptor) {
      it('should queue all requests while token is being refreshed', async () => {
        authService.authenticate();
        httpClient.get(testUrl).subscribe();
        const firstRequest = httpTestingController.expectOne(testUrl);
        expect(firstRequest.request.headers.has('Authorization')).toEqual(true);
        firstRequest.flush(
          { error: 'invalid_grant' },
          {
            status: 401,
            statusText: 'Unauthorized',
          }
        );
        httpClient.get(testUrl).subscribe();
        httpClient.get(testUrl).subscribe();
        httpClient.get(testUrl).subscribe();

        const requests = httpTestingController.match(testUrl);
        expect(requests.length).toEqual(0);
      });
    }
  });
});
