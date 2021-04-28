import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient } from "@angular/common/http";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";
import { Location } from "@angular/common";
import { RouterTestingModule } from "@angular/router/testing";
import { AccountInfo, AuthError, InteractionType, IPublicClientApplication, PublicClientApplication, SilentRequest } from '@azure/msal-browser';
import { MsalModule, MsalService, MsalInterceptor, MsalBroadcastService } from './public-api';
import { MsalInterceptorConfiguration } from './msal.interceptor.config';

let interceptor: MsalInterceptor;
let httpMock: HttpTestingController;
let httpClient: HttpClient;
let testInteractionType: InteractionType;

let testInterceptorConfig: Partial<MsalInterceptorConfiguration> = {};

const sampleAccountInfo: AccountInfo = {
  homeAccountId: "test",
  localAccountId: "test",
  environment: "test",
  tenantId: "test-tenant",
  username: "test"
}

function MSALInstanceFactory(): IPublicClientApplication {
  return new PublicClientApplication({
    auth: {
      clientId: '6226576d-37e9-49eb-b201-ec1eeb0029b6',
      redirectUri: 'http://localhost:4200'
    }
  });
}

function MSALInterceptorFactory(): MsalInterceptorConfiguration {
  return {
    //@ts-ignore
    interactionType: testInteractionType,
    protectedResourceMap: new Map([
      ["https://graph.microsoft.com/v1.0/me", ["user.read"]],
      ["https://myapplication.com/user/*", ["customscope.read"]],
      ["http://localhost:4200/details", ["details.read"]],
      ["https://*.myapplication.com/*", ["mail.read"]],
      ["https://api.test.com", ["default.scope1"]],
      ["https://*.test.com", ["default.scope2"]],
      ["http://localhost:3000/unprotect", null],
      ["http://localhost:3000/", ["base.scope"]],
      ["http://apps.com/tenant?abc", ["query.scope"]],
      ["http://applicationA/slash/", ["custom.scope"]],
      ["http://applicationB/noSlash", ["custom.scope"]],
      ["http://applicationC.com", [
        {"POST": ["write.scope"]}
      ]],
      ["http://applicationD.com", [
        "all.scope",
        {"GET": ["read.scope"]}
      ]],
    ]),
    authRequest: testInterceptorConfig.authRequest
  }
}

function initializeMsal() {
  TestBed.resetTestingModule();

  TestBed.configureTestingModule({
    imports: [
      HttpClientTestingModule,
      RouterTestingModule,
      MsalModule.forRoot(MSALInstanceFactory(), null, MSALInterceptorFactory())
    ],
    providers: [
      MsalInterceptor,
      MsalService,
      MsalBroadcastService,
      {
        provide: HTTP_INTERCEPTORS,
        useClass: MsalInterceptor,
        multi: true,
      },
      Location
    ],
  });

  interceptor = TestBed.inject(MsalInterceptor);
  httpMock = TestBed.inject(HttpTestingController);
  httpClient = TestBed.inject(HttpClient);
}

describe('MsalInterceptor', () => {
  beforeEach(() => {
    testInteractionType = InteractionType.Popup;
    testInterceptorConfig = {};
    initializeMsal();
  });

  it("throws error if incorrect interaction type set in interceptor configuration", (done) => {
    testInteractionType = InteractionType.Silent;
    initializeMsal();

    httpClient.get("https://graph.microsoft.com/v1.0/me").subscribe({
      error: (error) => {
        expect(error.errorCode).toBe("invalid_interaction_type");
        expect(error.errorMessage).toBe("Invalid interaction type provided to MSAL Interceptor. InteractionType.Popup, InteractionType.Redirect must be provided in the msalInterceptorConfiguration");
        testInteractionType = InteractionType.Popup;
        done();
      }
    });
  });

  it("does not attach authorization header for unprotected resource", (done) => {
    httpClient.get("http://localhost/api").subscribe(response => expect(response).toBeTruthy());

    const request = httpMock.expectOne("http://localhost/api");
    request.flush({ data: "test" });
    expect(request.request.headers.get("Authorization")).toBeUndefined;
    httpMock.verify();
    done();
  });

  it("does not attach authorization header for own domain", (done) => {
    httpClient.get("http://localhost:4200").subscribe(response => expect(response).toBeTruthy());

    const request = httpMock.expectOne("http://localhost:4200");
    request.flush({ data: "test" });
    expect(request.request.headers.get("Authorization")).toBeUndefined;
    httpMock.verify();
    done();
  });

  it("attaches authorization header with access token for protected resource with exact match", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getActiveAccount").and.returnValue(sampleAccountInfo);

    httpClient.get("https://graph.microsoft.com/v1.0/me").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://graph.microsoft.com/v1.0/me");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token via interaction if acquireTokenSilent returns null access token", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: null
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "acquireTokenPopup").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getActiveAccount").and.returnValue(sampleAccountInfo);

    httpClient.get("https://graph.microsoft.com/v1.0/me").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://graph.microsoft.com/v1.0/me");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for protected resource with wildcard", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("https://myapplication.com/user/1").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://myapplication.com/user/1");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token to url for protected resource with wildcard, url has multiple slashes", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("https://myapplication.com/user/1/2/3").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://myapplication.com/user/1/2/3");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for protected resource with multiple wildcards", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("https://mail.myapplication.com/me").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://mail.myapplication.com/me");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for base url as protected resource", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("http://localhost:3000/details").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("http://localhost:3000/details");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for multiple matching entries in protected resource", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("https://api.test.com").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://api.test.com");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("does not attach authorization header when scopes set to null, and resource is before any base url or wildcards", done => {
    httpClient.get("http://localhost:3000/unprotect").subscribe(response => expect(response).toBeTruthy());

    const request = httpMock.expectOne("http://localhost:3000/unprotect");
    request.flush({ data: "test" });
    expect(request.request.headers.get("Authorization")).toBeUndefined;
    httpMock.verify();
    done();
  });

  it("attaches authorization header with access token from acquireTokenPopup if acquireTokenSilent fails in interceptor and interaction type is Popup", done => {
    const sampleError = new AuthError("123", "message");
    const sampleAccessToken = {
      accessToken: "123abc"
    };

    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve, reject) => {
        reject(sampleError);
      })
    ));

    spyOn(PublicClientApplication.prototype, "acquireTokenPopup").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve(sampleAccessToken);
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("https://graph.microsoft.com/v1.0/me").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://graph.microsoft.com/v1.0/me");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer 123abc");
      httpMock.verify();
      done();
    }, 200);
  });

  it("does not attach authorization header if acquireTokenSilent fails in interceptor and interaction type is Redirect", done => {
    testInteractionType = InteractionType.Redirect;
    initializeMsal();
    const sampleError = new AuthError("123", "message");

    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve, reject) => {
        reject(sampleError);
      })
    ));

    spyOn(PublicClientApplication.prototype, "acquireTokenRedirect").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve();
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("https://graph.microsoft.com/v1.0/me").subscribe();
    setTimeout(() => {
      const request = httpMock.expectNone("https://graph.microsoft.com/v1.0/me");
      expect(request).toBeUndefined();
      httpMock.verify();
      done();
    }, 200);
  });


  it("keeps original authority, https://login.microsoftonline.com/common", done => {
    testInterceptorConfig.authRequest = {
      authority: 'https://login.microsoftonline.com/common'
    };
    initializeMsal();
    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.callFake((silentRequest: SilentRequest) => new Promise((resolve) => {
      //@ts-ignore
      resolve({
        accessToken: `access-token-for-${silentRequest.authority}`
      });
    }));

    httpClient.get("https://api.test.com").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://api.test.com");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token-for-https://login.microsoftonline.com/common");
      httpMock.verify();
      done();
    }, 200);

  });

  it("calls dynamic authority with account, authority override", done => {
    testInterceptorConfig.authRequest = (msalService, httpReq, authRequest) => {
      return {
        ...authRequest,
        authority: `https://login.microsoftonline.com/${authRequest.account.tenantId}`
      };
    }
    initializeMsal();
    spyOn(PublicClientApplication.prototype, "getActiveAccount").and.returnValue(sampleAccountInfo);
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.callFake((silentRequest: SilentRequest) => new Promise((resolve) => {
      //@ts-ignore
      resolve({
        accessToken: `access-token-for-${silentRequest.authority}`
      });
    }));

    httpClient.get("https://api.test.com").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("https://api.test.com");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token-for-https://login.microsoftonline.com/test-tenant");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for protected resource with queries", done => {
    spyOn(PublicClientApplication.prototype, "getActiveAccount").and.returnValue(sampleAccountInfo);
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    httpClient.get("http://apps.com/tenant?abc").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("http://apps.com/tenant?abc");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for protected resource with trailing slash", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("http://applicationA/slash").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("http://applicationA/slash");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for endpoint with trailing slash", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("http://applicationB/noSlash/").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("http://applicationB/noSlash/");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for relative endpoint", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("/v1.0/me").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("/v1.0/me");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for relative endpoint which includes query", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.get("/tenant?abc").subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("/tenant?abc");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

  it("attaches authorization header with access token for endpoint with HTTP methods specified", done => {
    spyOn(PublicClientApplication.prototype, "acquireTokenSilent").and.returnValue((
      new Promise((resolve) => {
        //@ts-ignore
        resolve({
          accessToken: "access-token"
        });
      })
    ));

    spyOn(PublicClientApplication.prototype, "getAllAccounts").and.returnValue([sampleAccountInfo]);

    httpClient.post("http://applicationC.com", {}).subscribe();
    setTimeout(() => {
      const request = httpMock.expectOne("http://applicationC.com");
      request.flush({ data: "test" });
      expect(request.request.headers.get("Authorization")).toEqual("Bearer access-token");
      httpMock.verify();
      done();
    }, 200);
  });

});

describe("matchScopesToEndpoint unit tests", () => {
  it("returns scopes when scopes in a string array", () => {
    const protectedResourceMap = MSALInterceptorFactory().protectedResourceMap;
    const endpointArray = ["http://localhost:3000/"];
    const httpMethod = 'GET';
    const expectedScopes = ["base.scope"];

    expect(MsalInterceptor.matchScopesToEndpoint(protectedResourceMap, endpointArray, httpMethod)).toEqual(expectedScopes);
  });

  it("returns scopes when scopes in object with HTTP method", () => {
    const protectedResourceMap = MSALInterceptorFactory().protectedResourceMap;
    const endpointArray = ["http://applicationC.com"];
    const httpMethod = 'POST';
    const expectedScopes = ["write.scope"];

    expect(MsalInterceptor.matchScopesToEndpoint(protectedResourceMap, endpointArray, httpMethod)).toEqual(expectedScopes);
  });

  it("returns all relevant scopes when scopes in string array and scopes in object with HTTP method for same endpoint", () => {
    const protectedResourceMap = MSALInterceptorFactory().protectedResourceMap;
    const endpointArray = ["http://applicationD.com"];
    const httpMethod = 'GET';
    const expectedScopes = ["all.scope", "read.scope"];

    expect(MsalInterceptor.matchScopesToEndpoint(protectedResourceMap, endpointArray, httpMethod)).toEqual(expectedScopes);
  });

  it("does not return scopes if scopes set to null", () => {
    const protectedResourceMap = MSALInterceptorFactory().protectedResourceMap;
    const endpointArray = ["http://localhost:3000/unprotect"];
    const httpMethod = 'GET';
    const expectedScopes = null;

    expect(MsalInterceptor.matchScopesToEndpoint(protectedResourceMap, endpointArray, httpMethod)).toEqual(expectedScopes);
  });
  
  it("does not return scope if request HTTP method is not found", () => {
    const protectedResourceMap = MSALInterceptorFactory().protectedResourceMap;
    const endpointArray = ["http://applicationC.com"];
    const httpMethod = 'GET';
    const expectedScopes = null;

    expect(MsalInterceptor.matchScopesToEndpoint(protectedResourceMap, endpointArray, httpMethod)).toEqual(expectedScopes);
  });
  
  it("only returns first set of scopes if multiple matching endpoints", () => {
    const protectedResourceMap = MSALInterceptorFactory().protectedResourceMap;
    const endpointArray = ["http://applicationC.com", "http://applicationD.com"];
    const httpMethod = 'POST';
    const expectedScopes = ["write.scope"];

    expect(MsalInterceptor.matchScopesToEndpoint(protectedResourceMap, endpointArray, httpMethod)).toEqual(expectedScopes);
  });

});
