namespace NorthwindService;

entity Products {
  key ID : Integer;
  ProductName : String;
  UnitPrice : Decimal;
}

entity Customers {
  key ID : Integer;
  CompanyName : String;
  ContactName : String;
}

entity Orders {
  key ID : Integer;
  OrderDate : Date;
  CustomerID : Integer;
}
