import { Controller, Get, Injectable } from '@nestjs/common';

export class DeviceDashboardRepository {

     constructor(
        private readonly prisma : any
    ){}
    async create(finalData: any){
        if (!this.prisma) {
        throw new Error('PRISMA_MISSING');
        }
        return this.prisma.device.create(finalData);
    }

}