declare module "ali-oss" {
  namespace OSS {
    interface Options {
      region: string;
      accessKeyId: string;
      accessKeySecret: string;
      bucket: string;
    }

    interface PutObjectOptions {
      headers?: Record<string, string>;
    }

    interface PutResult {
      url?: string;
    }
  }

  class OSS {
    constructor(options: OSS.Options);
    put(name: string, file: Buffer, options?: OSS.PutObjectOptions): Promise<OSS.PutResult>;
    deleteMulti(names: string[], options?: { quiet?: boolean }): Promise<unknown>;
    listV2(options?: Record<string, unknown>): Promise<any>;
  }

  export default OSS;
}
