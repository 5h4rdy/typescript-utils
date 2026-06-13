import {GenericOrmMapper} from "../../../src/services/dao/mapper/GenericOrmMapper";
import {GenericOrmDoc} from "../../../src/services/dao/types/DbTypes";
import TestUtils from "../../../src/utils/TestUtils";

describe('GenericOrmMapper', () => {
    describe('toDomain', () => {
        it('should convert a valid ORM document to a domain model', () => {
            const ormDoc = {
                _id: 'some-id',
                appVersion: "a-version",
                createdDate: TestUtils.getRandomDate().toISOString(),
                updatedDate: TestUtils.getRandomDate().toISOString(),
            } as GenericOrmDoc;

            const domainModel = (new GenericOrmMapper()).toDomain(ormDoc);

            expect(domainModel).toEqual({
                id: 'some-id',
                createdDate: expect.any(Date),
                updatedDate: expect.any(Date),
            });
        });

        it('should throw an error when _id is missing', () => {
            // Invalid ORM document with missing _id
            const ormDoc = {
                createdDate: TestUtils.getRandomDate().toISOString(),
                updatedDate: TestUtils.getRandomDate().toISOString(),
            } as GenericOrmDoc;

            // Expect an error to be thrown
            expect(() => (new GenericOrmMapper()).toDomain(ormDoc)).toThrow(
                'Unable to map object with properties ID'
            );
        });

        it('should throw an error when createdDate is missing', () => {
            // Invalid ORM document with missing createdDate
            const ormDoc = {
                _id: 'some-id',
                updatedDate: TestUtils.getRandomDate().toISOString(),
            } as GenericOrmDoc;

            // Expect an error to be thrown
            expect(() => (new GenericOrmMapper()).toDomain(ormDoc)).toThrow(
                'Unable to map object with properties ID'
            );
        });
    });

    describe('toDB', () => {
        it('should convert a valid domain model to an ORM document', () => {
            const domainModel = {
                id: 'some-id',
                createdDate: new Date(),
                updatedDate: new Date(),
            };

            const ormDoc = (new GenericOrmMapper()).toDB(domainModel);

            expect(ormDoc).toEqual({
                _id: 'some-id',
                createdDate: expect.any(String),
                updatedDate: expect.any(String),
            });
        });

        it('should omit updatedDate if it is undefined', () => {
            // Domain model with undefined updatedDate
            const domainModel = {
                id: 'some-id',
                createdDate: new Date(),
                // No updatedDate property
            };

            const ormDoc = (new GenericOrmMapper()).toDB(domainModel);

            expect(ormDoc).toEqual({
                _id: 'some-id',
                createdDate: expect.any(String),
                // updatedDate should not be present
            });
        });
    });
});
