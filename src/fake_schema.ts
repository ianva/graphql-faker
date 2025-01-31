import {
  Kind,
  isLeafType,
  isAbstractType,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLAbstractType,
  GraphQLOutputType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLLeafType,
} from 'graphql';

import {
  getRandomInt,
  getRandomItem,
  stdScalarFakers,
  fakeValue,
} from './fake';

import {count} from './count';

interface GraphQLAppliedDirectives {
  isApplied(directiveName: string): boolean;
  getAppliedDirectives(): Array<string>;
  getDirectiveArgs(directiveName: string): { [argName: string]: any };
}

type FakeArgs = {
  type:string
  options: {[key:string]: any}
  locale: string
};
type ExamplesArgs = {
  values:[any]
};
type SampleArgs = {
  min: number;
  max: number;
};
type DirectiveArgs = {
  fake?: FakeArgs
  examples?: ExamplesArgs
  sample ?: SampleArgs
};

const stdTypeNames = Object.keys(stdScalarFakers);

function astToJSON(ast) {
  switch (ast.kind) {
    case Kind.NULL:
      return null;
    case Kind.INT:
      return parseInt(ast.value, 10);
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.LIST:
      return ast.values.map(astToJSON);
    case Kind.OBJECT:
      return ast.fields.reduce((object, {name, value}) => {
        object[name.value] = astToJSON(value);
        return object;
      }, {});
  }
}

export function fakeSchema(schema: GraphQLSchema) {
  const mutationType = schema.getMutationType();
  const jsonType = schema.getTypeMap()['examples__JSON'];
  jsonType['parseLiteral'] = astToJSON;

  for (const type of Object.values(schema.getTypeMap())) {
    if (type instanceof GraphQLScalarType && !stdTypeNames.includes(type.name)) {
      type.serialize = (value => value);
      type.parseLiteral = astToJSON;
      type.parseValue = (x => x);
    }
    if (type instanceof GraphQLObjectType && !type.name.startsWith('__'))
      addFakeProperties(type);
    if (isAbstractType(type))
      type.resolveType = (obj => obj.__typename);
  };

  function addFakeProperties(objectType:GraphQLObjectType) {
    const isMutation = (objectType === mutationType);

    for (const field of Object.values(objectType.getFields())) {
      if (isMutation && isRelayMutation(field))
        field.resolve = getRelayMutationResolver();
      else
        field.resolve = getFieldResolver(field, objectType);
    }
  }

  function isRelayMutation(field) {
    const args = field.args;
    if (args.length !== 1 || args[0].name !== 'input')
      return false;

    const inputType = args[0].type;
    // TODO: check presence of 'clientMutationId'
    return (
      inputType instanceof GraphQLNonNull &&
      inputType.ofType instanceof GraphQLInputObjectType &&
      field.type instanceof GraphQLObjectType
    );
  }

  function getFieldResolver(field, objectType) {
    const fakeResolver = getResolver(field.type, field);
    return (source, _0, _1, info) => {
      if (source && source.$example && source[field.name]) {
        return source[field.name];
      }

      const value = getCurrentSourceProperty(source, info.path);
      return (value !== undefined) ? value : fakeResolver(objectType);
    }
  }

  function getRelayMutationResolver() {
    return (source, args, _1, info) => {
      const value = getCurrentSourceProperty(source, info.path);
      if (value instanceof Error)
        return value;
      return {...args['input'], ...value};
    }
  }

  // get value or Error instance injected by the proxy
  function getCurrentSourceProperty(source, path) {
    return source && source[path!.key];
  }

  function getResolver(type:GraphQLOutputType, field) {

    if (type instanceof GraphQLNonNull){
      return getResolver(type.ofType, field);
    }

    if (type instanceof GraphQLList) {
      return arrayResolver(getResolver(type.ofType, field), getFakeDirectives(field));
    }

    if (isAbstractType(type)){
      return abstractTypeResolver(type);
    }

    return fieldResolver(type, field);
  }


  function abstractTypeResolver(type:GraphQLAbstractType) {
    const possibleTypes = schema.getPossibleTypes(type);
    return () => ({__typename: getRandomItem(possibleTypes)});
  }
}

function fieldResolver(type:GraphQLOutputType, field) {
  const directiveToArgs = {
    ...getFakeDirectives(type),
    ...getFakeDirectives(field),
  };
  const {fake, examples} = directiveToArgs;

  if (isLeafType(type)) {
    if (examples)
      return () => getRandomItem(examples.values)
    if (fake) {
      count.clear();
      return () => fakeValue(fake.type, fake.options, fake.locale);
    }
    return () => fakeLeafValue(type);
  } else {
    // TODO: error on fake directive
    if (examples) {
      return () => ({
        ...getRandomItem(examples.values),
        $example: true,
      });
    }
    return () => ({});
  }
}

function arrayResolver(itemResolver, { sample }: DirectiveArgs) {
  const options = {
    min: 2,
    max: 4,
    ...sample,
  } as SampleArgs;

  if (options.min > options.max) {
    options.max = ++options.min;
  }

  return (...args) => {
    let length = getRandomInt(options.min, options.max);
    const result = [];
    while (length-- !== 0)
      result.push(itemResolver(...args));

    return result;
  }
}

function getFakeDirectives(object: any) {
  const directives = object['appliedDirectives'] as GraphQLAppliedDirectives;
  if (!directives)
    return {};

  const result = {} as DirectiveArgs;
  if (directives.isApplied('fake'))
    result.fake = directives.getDirectiveArgs('fake') as FakeArgs;
  if (directives.isApplied('examples'))
    result.examples = directives.getDirectiveArgs('examples') as ExamplesArgs;
  if (directives.isApplied('sample')){
    result.sample = directives.getDirectiveArgs('sample') as SampleArgs;
  }
  return result;
}

function fakeLeafValue(type:GraphQLLeafType) {
  if (type instanceof GraphQLEnumType) {
    const values = type.getValues().map(x => x.value);
    return getRandomItem(values);
  }

  const faker = stdScalarFakers[type.name];
  if (faker)
    return faker();

  return `<${type.name}>`;
}
