class Count {
  private _num: number;
  private _temp: number = 0;

  constructor(num = 0) {
    this._num = num;
  }
  set num(value) {
    this._num = value;
  }
  get num() {
    return this._num;
  }
  clear() {
    this._temp = 0;
  }
  run() {
    const result = this.num + this._temp;
    this._temp++;
    return result;
  }
}

export const count =  new Count();
