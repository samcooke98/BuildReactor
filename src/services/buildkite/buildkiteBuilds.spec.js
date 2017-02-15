import 'test/rxHelpers';
import Rx from 'rx/dist/rx.testing';
import builds from 'services/buildkite/buildkiteBuilds';
import requests from 'services/buildkite/buildkiteRequests';
import sinon from 'sinon';

describe('services/buildkite/buildkiteBuilds', () => {

    const onNext = Rx.ReactiveTest.onNext;
    const onCompleted = Rx.ReactiveTest.onCompleted;
    let scheduler;
    let settings;
    beforeEach(() => {
        scheduler = new Rx.TestScheduler();
        sinon.stub(requests, 'organizations');
        sinon.stub(requests, 'pipelines');
        sinon.stub(requests, 'latestBuild');
        sinon.stub(requests, 'latestFinishedBuild');

        settings = {
            token: 'token',
            projects: ['org/pipeline']
        };
    });

    afterEach(() => {
        requests.organizations.restore();
        requests.pipelines.restore();
        requests.latestBuild.restore();
        requests.latestFinishedBuild.restore();
    });

    describe('getAll', () => {

        it('should pass token to organizations', () => {
            requests.organizations.returns(Rx.Observable.empty());

            builds.getAll(settings);

            sinon.assert.calledOnce(requests.organizations);
            sinon.assert.calledWith(requests.organizations, settings.token);
        });

        it('should return empty items if no organizations', () => {
            requests.organizations.returns(Rx.Observable.empty());

            const result = scheduler.startScheduler(() => builds.getAll(settings));

            expect(result.messages).toHaveEqualElements(
                onNext(200, { items: [] }),
                onCompleted(200)
            );
        });

        it('should pass url and token to pipelines', () => {
            requests.organizations.returns(Rx.Observable.return(
                { name: 'name', pipelines_url: 'url' }
            ));
            requests.pipelines.returns(Rx.Observable.empty());

            scheduler.startScheduler(() => builds.getAll(settings));

            sinon.assert.calledOnce(requests.pipelines);
            sinon.assert.calledWith(requests.pipelines, 'url', settings.token);
        });


        it('should return sorted pipelines for organizations', () => {
            requests.organizations.returns(Rx.Observable.return(
                { slug: 'org', name: 'org_name', pipelines_url: 'url' }
            ));
            requests.pipelines.returns(Rx.Observable.fromArray([
                { slug: "slug2", name: 'pipeline2' },
                { slug: "slug1", name: 'pipeline1' }
            ]));

            const result = scheduler.startScheduler(() => builds.getAll(settings));

            expect(result.messages).toHaveEqualElements(
                onNext(200, {
                    items: [
                        {
                            id: 'org/slug1',
                            name: 'pipeline1',
                            group: 'org_name',
                            isDisabled: false
                        },
                        {
                            id: 'org/slug2',
                            name: 'pipeline2',
                            group: 'org_name',
                            isDisabled: false
                        }
                    ]
                }),
                onCompleted(200)
            );
        });
    });

    describe('getLatest', () => {

        it('should pass org, pipeline and token to builds', () => {
            settings.projects = ['org/pipeline1', 'org/pipeline2'];
            requests.latestBuild.returns(Rx.Observable.empty());

            scheduler.startScheduler(() => builds.getLatest(settings));

            sinon.assert.calledTwice(requests.latestBuild);
            sinon.assert.calledWith(requests.latestBuild, 'org', 'pipeline1', settings.token);
            sinon.assert.calledWith(requests.latestBuild, 'org', 'pipeline2', settings.token);
        });

        it('should return empty items if no builds', () => {
            requests.latestBuild.returns(Rx.Observable.empty());

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages).toHaveEqualElements(
                onNext(200, { items: [] }),
                onCompleted(200)
            );
        });

        it('should return parsed builds', () => {
            settings.projects = ['org/pipeline1', 'org/pipeline2'];
            const build1 = {
                web_url: 'https://buildkite.com/org/pipeline1/builds/15',
                pipeline: { name: 'pipeline1' },
            };
            const build2 = {
                web_url: 'https://buildkite.com/org/pipeline2/builds/2',
                pipeline: { name: 'pipeline2' },
            };
            requests.latestBuild
                .withArgs('org', 'pipeline1', settings.token)
                .returns(Rx.Observable.return(build1))
                .withArgs('org', 'pipeline2', settings.token)
                .returns(Rx.Observable.return(build2));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages).toHaveEqualElements(
                onNext(200),
                onCompleted(200)
            );
            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                id: 'org/pipeline1',
                name: 'pipeline1',
                group: 'org',
                webUrl: 'https://buildkite.com/org/pipeline1/builds/15',
                isDisabled: false,
                isBroken: false,
                isRunning: false
            }));
            expect(result.messages[0].value.value.items[1]).toEqual(jasmine.objectContaining({
                id: 'org/pipeline2',
                name: 'pipeline2',
                group: 'org',
                webUrl: 'https://buildkite.com/org/pipeline2/builds/2',
                isDisabled: false,
                isBroken: false,
                isRunning: false
            }));
        });

        it('should return error if updating build fails', () => {
            settings.projects = ['org/pipeline1', 'org/pipeline2'];
            const build2 = {
                web_url: 'https://buildkite.com/org/pipeline2/builds/2',
                pipeline: { name: 'pipeline2' },
            };
            requests.latestBuild
                .withArgs('org', 'pipeline1', settings.token)
                .returns(Rx.Observable.throw({ message: 'error message' }))
                .withArgs('org', 'pipeline2', settings.token)
                .returns(Rx.Observable.return(build2));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages).toHaveEqualElements(
                onNext(200),
                onCompleted(200)
            );
            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                id: 'org/pipeline1',
                name: 'pipeline1',
                group: 'org',
                error: { message: 'error message' }
            }));
            expect(result.messages[0].value.value.items[1]).toEqual(jasmine.objectContaining({
                id: 'org/pipeline2',
                name: 'pipeline2',
                group: 'org',
                webUrl: 'https://buildkite.com/org/pipeline2/builds/2',
                isDisabled: false,
                isBroken: false,
                isRunning: false
            }));
        });

        it('should return failed build', () => {
            requests.latestBuild.returns(Rx.Observable.return({ state: 'failed' }));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                isBroken: true
            }));
        });

        it('should return running build', () => {
            requests.latestBuild.returns(Rx.Observable.return({ state: 'running' }));
            requests.latestFinishedBuild.returns(Rx.Observable.return({ state: 'failed' }));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                isBroken: true,
                isRunning: true
            }));
        });

        it('should return waiting build', () => {
            requests.latestBuild.returns(Rx.Observable.return({ state: 'scheduled' }));
            requests.latestFinishedBuild.returns(Rx.Observable.return({ state: 'failed' }));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                isBroken: true,
                isRunning: false,
                isWaiting: true
            }));
        });

        it('should parse canceled as tags', () => {
            requests.latestBuild.returns(Rx.Observable.return({ state: 'canceled' }));
            requests.latestFinishedBuild.returns(Rx.Observable.return({ state: 'passed' }));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                tags: [{ name: 'Canceled', type: 'warning' }]
            }));
        });

        it('should parse canceling as tags', () => {
            requests.latestBuild.returns(Rx.Observable.return({ state: 'canceling' }));
            requests.latestFinishedBuild.returns(Rx.Observable.return({ state: 'failed' }));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                tags: [{ name: 'Canceled', type: 'warning' }]
            }));
        });

        it('should parse not_run as tags', () => {
            requests.latestBuild.returns(Rx.Observable.return({ state: 'not_run' }));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                tags: [{ name: 'Not built', type: 'warning' }]
            }));
        });

        it('should parse changes', () => {
            requests.latestBuild.returns(Rx.Observable.return({
                message: 'message',
                creator: { name: 'creator name' }
            }));

            const result = scheduler.startScheduler(() => builds.getLatest(settings));

            expect(result.messages[0].value.value.items[0]).toEqual(jasmine.objectContaining({
                changes: [{ name: 'creator name', message: 'message' }]
            }));
        });

    });
});
